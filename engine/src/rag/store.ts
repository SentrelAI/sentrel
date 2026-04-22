// RAG store — libsql (Turso SQLite fork) with native F32_BLOB
// vector type and vector_distance_cos().
//
// One .sqlite file per scope:
//   - agent_data/rag/agent-{id}.db — personal knowledge per agent.
//   - agent_data/rag/org-{id}.db   — org-shared knowledge every agent in the
//                                     org searches alongside its own.
//
// Every exported function takes a `Scope` so the same code serves both paths.

import { createClient, type Client } from "@libsql/client";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type Scope = { kind: "agent"; id: number } | { kind: "org"; id: number };
export const agentScope = (id: number): Scope => ({ kind: "agent", id });
export const orgScope   = (id: number): Scope => ({ kind: "org", id });
const scopeKey = (s: Scope) => `${s.kind}:${s.id}`;

export interface RagDocument {
  id: number;
  title: string;
  source_type: "pdf" | "markdown" | "text" | "url" | "html";
  source_url: string | null;
  content_hash: string;
  chunk_count: number;
  metadata: Record<string, unknown>;
  indexed_at: string | null;
  created_at: string;
}

export interface SearchResult {
  chunk_id: number;
  document_id: number;
  document_title: string;
  content: string;
  context: string | null;
  chunk_index: number;
  distance: number; // cosine distance (0 = identical, 2 = opposite)
  metadata: Record<string, unknown>;          // chunk metadata
  document_metadata: Record<string, unknown>; // parent document metadata (for per-doc threshold etc.)
}

// Cache one client per scope — avoids re-opening the file on every call
const clients = new Map<string, Client>();
const initialized = new Set<string>();

function dbPathFor(scope: Scope): string {
  const dir = path.join(config.dataDir, "rag");
  fs.mkdirSync(dir, { recursive: true });
  const prefix = scope.kind === "agent" ? "agent" : "org";
  return path.join(dir, `${prefix}-${scope.id}.db`);
}

async function openDb(scope: Scope): Promise<Client> {
  const key = scopeKey(scope);
  const cached = clients.get(key);
  if (cached && initialized.has(key)) return cached;

  const db = cached ?? createClient({ url: `file:${dbPathFor(scope)}` });
  if (!cached) clients.set(key, db);

  // Schema migrations — idempotent
  await db.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      content_hash TEXT NOT NULL UNIQUE,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      indexed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      context TEXT,
      embedding F32_BLOB(384),
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id)`);
  // Vector index on the embedding column for sub-linear nearest-neighbor search
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_chunks_vec ON chunks(libsql_vector_idx(embedding))`);

  // FTS5 virtual table for keyword / hybrid search (catches IDs, proper nouns)
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content, context,
      content='chunks',
      content_rowid='id',
      tokenize='porter unicode61'
    )
  `);
  // Keep FTS in sync
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS chunks_fts_ins AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, content, context) VALUES (new.id, new.content, new.context);
    END
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS chunks_fts_del AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, content, context)
        VALUES ('delete', old.id, old.content, old.context);
    END
  `);

  initialized.add(scopeKey(scope));
  return db;
}

function vecLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// ── Document operations ──────────────────────────────────────

export async function upsertDocument(
  scope: Scope,
  doc: {
    title: string;
    source_type: RagDocument["source_type"];
    source_url?: string | null;
    content_hash: string;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  const db = await openDb(scope);
  // Idempotent by content_hash
  const existing = await db.execute({
    sql: "SELECT id FROM documents WHERE content_hash = ? LIMIT 1",
    args: [doc.content_hash],
  });
  if (existing.rows.length > 0) return Number(existing.rows[0]!.id);

  const res = await db.execute({
    sql: `INSERT INTO documents (title, source_type, source_url, content_hash, metadata, indexed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id`,
    args: [
      doc.title,
      doc.source_type,
      doc.source_url ?? null,
      doc.content_hash,
      JSON.stringify(doc.metadata ?? {}),
    ],
  });
  return Number(res.rows[0]!.id);
}

export async function listDocuments(scope: Scope): Promise<RagDocument[]> {
  const db = await openDb(scope);
  const res = await db.execute(`
    SELECT id, title, source_type, source_url, content_hash, chunk_count, metadata, indexed_at, created_at
    FROM documents ORDER BY created_at DESC
  `);
  return res.rows.map((r: any) => ({
    id: Number(r.id),
    title: String(r.title),
    source_type: r.source_type as any,
    source_url: r.source_url as string | null,
    content_hash: String(r.content_hash),
    chunk_count: Number(r.chunk_count),
    metadata: JSON.parse((r.metadata as string) || "{}"),
    indexed_at: r.indexed_at as string | null,
    created_at: String(r.created_at),
  }));
}

export async function deleteDocument(scope: Scope, documentId: number): Promise<void> {
  const db = await openDb(scope);
  await db.batch([
    { sql: "DELETE FROM chunks WHERE document_id = ?", args: [documentId] },
    { sql: "DELETE FROM documents WHERE id = ?", args: [documentId] },
  ]);
}

// ── Chunk operations ─────────────────────────────────────────

export async function insertChunks(
  scope: Scope,
  documentId: number,
  chunks: Array<{
    chunk_index: number;
    content: string;
    context?: string | null;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>,
): Promise<void> {
  if (chunks.length === 0) return;
  const db = await openDb(scope);

  // Batch insert — single transaction by libsql
  const statements = chunks.map((c) => ({
    sql: `INSERT INTO chunks (document_id, chunk_index, content, context, embedding, metadata)
          VALUES (?, ?, ?, ?, vector32(?), ?)`,
    args: [
      documentId,
      c.chunk_index,
      c.content,
      c.context ?? null,
      vecLiteral(c.embedding),
      JSON.stringify(c.metadata ?? {}),
    ],
  }));
  statements.push({
    sql: "UPDATE documents SET chunk_count = chunk_count + ? WHERE id = ?",
    args: [chunks.length, documentId],
  });
  await db.batch(statements);
}

// ── Search ───────────────────────────────────────────────────

// Hybrid search: vector similarity + FTS keyword match, merged via
// Reciprocal Rank Fusion (K=60, top-K fused from both lists).
export async function hybridSearch(
  scope: Scope,
  queryEmbedding: number[],
  queryText: string,
  limit = 5,
): Promise<SearchResult[]> {
  const db = await openDb(scope);
  const K = 60;
  const CANDIDATES = Math.max(20, limit * 4);

  // Vector search — ANN via libsql_vector_idx
  const vecRes = await db.execute({
    sql: `
      SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.context, c.metadata,
             d.title AS document_title, d.metadata AS doc_metadata,
             vector_distance_cos(c.embedding, vector32(?)) AS distance
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      ORDER BY distance
      LIMIT ?
    `,
    args: [vecLiteral(queryEmbedding), CANDIDATES],
  });

  // FTS keyword search
  let ftsRows: any[] = [];
  if (queryText.trim()) {
    try {
      const ftsQuery = queryText.trim().split(/\s+/).filter(Boolean)
        .map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
      if (ftsQuery) {
        const ftsRes = await db.execute({
          sql: `
            SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.context, c.metadata,
                   d.title AS document_title, d.metadata AS doc_metadata, bm25(chunks_fts) AS bm25_score
            FROM chunks_fts
            JOIN chunks c ON c.id = chunks_fts.rowid
            JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ?
            ORDER BY bm25_score
            LIMIT ?
          `,
          args: [ftsQuery, CANDIDATES],
        });
        ftsRows = ftsRes.rows as any[];
      }
    } catch (err) {
      logger.warn("RAG FTS query failed, using vector only", { error: (err as Error).message });
    }
  }

  // Reciprocal Rank Fusion
  const scores = new Map<number, { row: any; score: number }>();
  (vecRes.rows as any[]).forEach((r, i) => {
    scores.set(Number(r.chunk_id), { row: r, score: 1 / (K + i + 1) });
  });
  ftsRows.forEach((r, i) => {
    const id = Number(r.chunk_id);
    const existing = scores.get(id);
    if (existing) {
      existing.score += 1 / (K + i + 1);
    } else {
      scores.set(id, { row: r, score: 1 / (K + i + 1) });
    }
  });

  const ranked = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  return ranked.map(({ row, score }) => ({
    chunk_id: Number(row.chunk_id),
    document_id: Number(row.document_id),
    document_title: String(row.document_title),
    content: String(row.content),
    context: row.context as string | null,
    chunk_index: Number(row.chunk_index),
    distance: row.distance != null ? Number(row.distance) : 1 - score,
    metadata: JSON.parse((row.metadata as string) || "{}"),
    document_metadata: JSON.parse((row.doc_metadata as string) || "{}"),
  }));
}

export async function closeAllRagDbs(): Promise<void> {
  for (const db of clients.values()) {
    try { db.close(); } catch {}
  }
  clients.clear();
  initialized.clear();
}

// Search across the agent's personal KB and the org-shared KB. Results from
// both are scored independently by the scope's own hybridSearch, then merged
// by raw distance (lower is better) with a source annotation so citations
// can say "per our Compliance KB" vs "per your own notes".
export async function searchMerged(
  orgId: number,
  agentId: number,
  queryEmbedding: number[],
  queryText: string,
  limit = 5,
): Promise<Array<SearchResult & { source: "agent" | "org" }>> {
  const [agentHits, orgHits] = await Promise.all([
    hybridSearch(agentScope(agentId), queryEmbedding, queryText, limit).catch(() => []),
    hybridSearch(orgScope(orgId),     queryEmbedding, queryText, limit).catch(() => []),
  ]);
  const merged: Array<SearchResult & { source: "agent" | "org" }> = [
    ...agentHits.map((h) => ({ ...h, source: "agent" as const })),
    ...orgHits.map((h)   => ({ ...h, source: "org"   as const })),
  ];
  merged.sort((a, b) => a.distance - b.distance);
  return merged.slice(0, limit);
}

// Copy a document + its chunks + embeddings from one scope to another.
// Used by the `share_to_org` tool when an agent promotes a personal doc
// to the shared org KB. Destination-dedupes on content_hash — calling
// again is a no-op.
export async function copyDocument(
  fromScope: Scope,
  toScope: Scope,
  documentId: number,
): Promise<{ destDocumentId: number; chunkCount: number; skipped: boolean } | null> {
  const src = await openDb(fromScope);
  const dst = await openDb(toScope);

  const docRow = await src.execute({
    sql: `SELECT title, source_type, source_url, content_hash, metadata FROM documents WHERE id = ? LIMIT 1`,
    args: [documentId],
  });
  if (docRow.rows.length === 0) return null;
  const d = docRow.rows[0]! as any;

  // Dedupe at destination by content_hash.
  const existing = await dst.execute({
    sql: `SELECT id, chunk_count FROM documents WHERE content_hash = ? LIMIT 1`,
    args: [String(d.content_hash)],
  });
  if (existing.rows.length > 0) {
    return { destDocumentId: Number(existing.rows[0]!.id), chunkCount: Number(existing.rows[0]!.chunk_count), skipped: true };
  }

  const inserted = await dst.execute({
    sql: `INSERT INTO documents (title, source_type, source_url, content_hash, metadata, indexed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id`,
    args: [
      String(d.title), String(d.source_type), d.source_url as string | null,
      String(d.content_hash), String(d.metadata || "{}"),
    ],
  });
  const destDocumentId = Number(inserted.rows[0]!.id);

  const chunks = await src.execute({
    sql: `SELECT chunk_index, content, context, embedding, metadata FROM chunks WHERE document_id = ? ORDER BY chunk_index`,
    args: [documentId],
  });

  if (chunks.rows.length > 0) {
    // libsql can't round-trip the F32_BLOB directly across connections with a
    // clean text shape, so re-embed via the vector32 literal if we have the
    // embedding as text. In practice chunks.embedding comes back as a Buffer;
    // we INSERT it as the same raw bytes.
    const statements = chunks.rows.map((r: any) => ({
      sql: `INSERT INTO chunks (document_id, chunk_index, content, context, embedding, metadata)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [destDocumentId, Number(r.chunk_index), String(r.content), r.context as string | null, r.embedding, String(r.metadata || "{}")],
    }));
    statements.push({
      sql: `UPDATE documents SET chunk_count = ? WHERE id = ?`,
      args: [chunks.rows.length, destDocumentId],
    });
    await dst.batch(statements);
  }

  logger.info(`RAG copy: ${fromScope.kind}:${fromScope.id} doc ${documentId} → ${toScope.kind}:${toScope.id} doc ${destDocumentId} (${chunks.rows.length} chunks)`);
  return { destDocumentId, chunkCount: chunks.rows.length, skipped: false };
}
