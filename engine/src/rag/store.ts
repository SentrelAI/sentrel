// Per-agent RAG store — libsql (Turso SQLite fork) with native F32_BLOB
// vector type and vector_distance_cos().
//
// Why libsql over vanilla SQLite + sqlite-vec:
//   - Ships prebuilt binaries for Bun/Node — no native rebuild dance.
//   - Native vector support (F32_BLOB, vector_distance_cos, libsql_vector_idx)
//     is built into the database. No loadable extensions.
//   - API works identically when swapping between local file and remote
//     Turso URL (useful if we ever want to sync RAG data).
//
// One .sqlite file per agent at agent_data/rag/agent-{id}.db.

import { createClient, type Client } from "@libsql/client";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";

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

// Cache one client per agent — avoids re-opening the file on every call
const clients = new Map<number, Client>();
const initialized = new Set<number>();

function dbPathFor(agentId: number): string {
  const dir = path.join(config.dataDir, "rag");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `agent-${agentId}.db`);
}

async function openDb(agentId: number): Promise<Client> {
  const cached = clients.get(agentId);
  if (cached && initialized.has(agentId)) return cached;

  const db = cached ?? createClient({ url: `file:${dbPathFor(agentId)}` });
  if (!cached) clients.set(agentId, db);

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

  initialized.add(agentId);
  return db;
}

function vecLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// ── Document operations ──────────────────────────────────────

export async function upsertDocument(
  agentId: number,
  doc: {
    title: string;
    source_type: RagDocument["source_type"];
    source_url?: string | null;
    content_hash: string;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  const db = await openDb(agentId);
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

export async function listDocuments(agentId: number): Promise<RagDocument[]> {
  const db = await openDb(agentId);
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

export async function deleteDocument(agentId: number, documentId: number): Promise<void> {
  const db = await openDb(agentId);
  await db.batch([
    { sql: "DELETE FROM chunks WHERE document_id = ?", args: [documentId] },
    { sql: "DELETE FROM documents WHERE id = ?", args: [documentId] },
  ]);
}

// ── Chunk operations ─────────────────────────────────────────

export async function insertChunks(
  agentId: number,
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
  const db = await openDb(agentId);

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
  agentId: number,
  queryEmbedding: number[],
  queryText: string,
  limit = 5,
): Promise<SearchResult[]> {
  const db = await openDb(agentId);
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
