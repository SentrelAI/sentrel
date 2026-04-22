// Knowledge tools — agent searches and promotes documents in the RAG store.
//
// search_knowledge: hybrid search across personal + org-shared KBs. Results
//   carry a source annotation so the agent knows whether a passage came from
//   its own uploads or the org-shared library.
// share_to_org:     copies a document from the agent's personal KB to the
//   org-shared KB so every teammate can retrieve it.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  listDocuments,
  searchMerged,
  copyDocument,
  agentScope,
  orgScope,
} from "../rag/store.js";
import { embedText, isEmbeddingReady } from "../integrations/tool-embeddings.js";
import { logger } from "../logger.js";

export function buildKnowledgeMcpServer(agentId: number, orgId: number) {
  const searchTool = tool(
    "search_knowledge",
    "Search the knowledge base — both your personal uploads and the org-shared library. Returns the most relevant passages with source citations and a [personal/org] marker. " +
      "CALL THIS FIRST when the user asks about product features, pricing, policies, company info, or anything domain-specific — before web search or guessing. Always cite the source document in your response.",
    {
      query: z.string().describe(
        "What you're looking for. Phrase it naturally — e.g. 'what is our HIPAA compliance policy' or 'enterprise tier pricing'."
      ),
      limit: z.number().int().min(1).max(20).optional()
        .describe("Max passages to return (default 5)."),
    },
    async (args) => {
      try {
        const [agentDocs, orgDocs] = await Promise.all([
          listDocuments(agentScope(agentId)).catch(() => []),
          listDocuments(orgScope(orgId)).catch(() => []),
        ]);
        if (agentDocs.length === 0 && orgDocs.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No documents are indexed for this agent or its org yet. Ask the user to upload relevant files at /agents/<id>/knowledge (personal) or promote an existing one to the org via `share_to_org`.",
            }],
          };
        }

        if (!isEmbeddingReady()) {
          return {
            content: [{
              type: "text",
              text: "Knowledge search is initializing (embedding model loading). Try again in a moment.",
            }],
            isError: true,
          };
        }

        const queryEmbedding = await embedText(args.query);
        if (!queryEmbedding) {
          return {
            content: [{ type: "text", text: "Failed to embed the query — try again." }],
            isError: true,
          };
        }

        const limit = args.limit ?? 5;
        const results = await searchMerged(orgId, agentId, queryEmbedding, args.query, limit);

        if (results.length === 0) {
          const known = [
            ...agentDocs.slice(0, 3).map((d) => `${d.title} (personal)`),
            ...orgDocs.slice(0, 3).map((d) => `${d.title} (org)`),
          ].join(", ");
          return {
            content: [{
              type: "text",
              text: `No matching passages found for "${args.query}". The knowledge base has ${agentDocs.length} personal + ${orgDocs.length} org document(s)${known ? `, including: ${known}` : ""}. Try a different query or different keywords.`,
            }],
          };
        }

        logger.info(`search_knowledge: "${args.query}" → ${results.length} results (${results.map((r) => r.source).join(",")})`);

        const formatted = results.map((r, i) => {
          const header = `[${i + 1}] Source: "${r.document_title}" (${r.source === "org" ? "org-shared" : "personal"}, chunk ${r.chunk_index + 1})`;
          const context = r.context ? `Context: ${r.context}` : "";
          const body = r.content;
          return [header, context, body].filter(Boolean).join("\n");
        }).join("\n\n---\n\n");

        return {
          content: [{
            type: "text",
            text: `Found ${results.length} passage(s). Cite the source document title when using this information in your response.\n\n${formatted}`,
          }],
        };
      } catch (err) {
        logger.error("search_knowledge failed", { error: (err as Error).message });
        return {
          content: [{ type: "text", text: `Search failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  const shareTool = tool(
    "share_to_org",
    "Promote one of your personal documents to the org-shared knowledge base so every teammate can retrieve it. Use for things everyone in the org would benefit from — company policies, product docs, compliance positions, standard answers.",
    {
      document_id: z.number().int().describe("ID of the document in your personal KB (from search_knowledge's source citation)."),
    },
    async (args) => {
      try {
        const result = await copyDocument(agentScope(agentId), orgScope(orgId), args.document_id);
        if (!result) {
          return { content: [{ type: "text", text: `Document ${args.document_id} not found in your personal knowledge base.` }], isError: true };
        }
        if (result.skipped) {
          return { content: [{ type: "text", text: `Document ${args.document_id} is already in the org-shared KB (no-op).` }] };
        }
        return { content: [{ type: "text", text: `Document ${args.document_id} promoted to org-shared KB as doc ${result.destDocumentId} (${result.chunkCount} chunks). Every teammate in the org will now see it in their search_knowledge results.` }] };
      } catch (err) {
        logger.error("share_to_org failed", { error: (err as Error).message });
        return { content: [{ type: "text", text: `Share failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "knowledge",
    version: "0.2.0",
    tools: [searchTool, shareTool],
  });
}
