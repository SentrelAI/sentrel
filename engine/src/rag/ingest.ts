// Ingest pipeline: extract → chunk → contextualize → embed → store.
//
// Same pipeline for Rails-uploaded docs and future standalone CLI ingestion.
// The caller does text extraction (PDF/URL/etc.) and passes raw text here.

import { chunkText, hashContent } from "./chunker.js";
import { contextualizeChunks } from "./contextualizer.js";
import { embedText, isEmbeddingReady } from "../integrations/tool-embeddings.js";
import * as store from "./store.js";
import { host } from "../host/index.js";
import { logger } from "../logger.js";

export interface IngestInput {
  /** Agent-scoped ingest (personal KB). Pass one of this or `orgId`. */
  agentId?: number;
  /** Org-scoped ingest (shared KB every agent in the org searches). */
  orgId?: number;
  title: string;
  sourceType: store.RagDocument["source_type"];
  sourceUrl?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  /** Whether to run Contextual Retrieval (Haiku prefix per chunk). Default true. */
  contextualize?: boolean;
}

export interface IngestResult {
  documentId: number;
  chunkCount: number;
  contentHash: string;
  skipped: boolean; // true if the content hash already existed
  durationMs: number;
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const start = Date.now();
  const { agentId, orgId, title, sourceType, sourceUrl, content, metadata, contextualize = true } = input;

  if (!agentId && !orgId) throw new Error("ingestDocument: pass agentId or orgId");
  if (agentId && orgId)   throw new Error("ingestDocument: pass either agentId or orgId, not both");
  const scope: store.Scope = agentId ? store.agentScope(agentId) : store.orgScope(orgId!);

  if (!isEmbeddingReady()) {
    throw new Error("Embedding model not ready — cannot ingest documents yet");
  }

  const contentHash = hashContent(content);

  // Idempotent: if this exact content was already ingested, skip
  const existingDocs = await store.listDocuments(scope);
  const already = existingDocs.find((d) => d.content_hash === contentHash);
  if (already) {
    return {
      documentId: already.id,
      chunkCount: already.chunk_count,
      contentHash,
      skipped: true,
      durationMs: Date.now() - start,
    };
  }

  // Track whether this is the very first document for this agent — on success
  // we flip the knowledge_base capability on automatically. Skipped for org
  // ingest (org-shared docs don't toggle per-agent capabilities).
  const wasFirstDocument = existingDocs.length === 0 && !!agentId;

  // Chunk
  const chunks = chunkText(content);
  logger.info(`RAG ingest [${scope.kind}:${scope.id}]: ${title} → ${chunks.length} chunks`);

  // Create the document record first (so chunks can reference it)
  const documentId = await store.upsertDocument(scope, {
    title, source_type: sourceType, source_url: sourceUrl ?? null,
    content_hash: contentHash, metadata,
  });

  // Contextual Retrieval (Haiku prefix per chunk)
  const contexts = contextualize
    ? await contextualizeChunks(content, chunks)
    : chunks.map(() => "");

  // Embed chunks (embed the contextualized version: context + content)
  const chunkRecords: Parameters<typeof store.insertChunks>[2] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const context = contexts[i] || "";
    const embeddingInput = context ? `${context}\n\n${chunk}` : chunk;
    const embedding = await embedText(embeddingInput);
    if (!embedding) {
      logger.warn(`RAG ingest: failed to embed chunk ${i}, skipping`);
      continue;
    }
    chunkRecords.push({
      chunk_index: i,
      content: chunk,
      context,
      embedding,
      metadata: {},
    });
  }

  await store.insertChunks(scope, documentId, chunkRecords);

  if (wasFirstDocument && agentId) {
    try {
      const flipped = await host.enableCapability(agentId, "knowledge_base");
      if (flipped) {
        logger.info(`RAG: auto-enabled knowledge_base capability for agent ${agentId} (first document ingested)`);
      }
    } catch (err) {
      logger.warn(`RAG: failed to auto-enable knowledge_base for agent ${agentId}`, { error: (err as Error).message });
    }
  }

  const durationMs = Date.now() - start;
  logger.info(`RAG ingest complete [${scope.kind}:${scope.id}]: ${title} (${chunkRecords.length} chunks, ${durationMs}ms)`);

  return {
    documentId,
    chunkCount: chunkRecords.length,
    contentHash,
    skipped: false,
    durationMs,
  };
}
