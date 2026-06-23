// File-finder tools — list_files / read_file.
//
// Unlike the knowledge base (search_knowledge), these files are NOT chunked or
// vectorized. They live as whole ActiveStorage blobs on the Rails side. The
// agent browses them with list_files and pulls a full file's text with
// read_file — best for structured docs, contracts, specs, reference material
// the agent should read end-to-end rather than semantically retrieve snippets.
//
// Data path:
//   list_files -> GET  <rails>/api/agent_files?agent_id=N   (engine secret)
//   read_file  -> GET  <rails>/api/blobs/<signed_id>        (signed-id auth)
//                 then extractFromBytes() for the text.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { railsInternalUrl } from "../host/rails-url.js";
import { extractFromBytes } from "../rag/extractor.js";
import { logger } from "../logger.js";

// Cap returned text so one large file can't blow the agent's context window.
const MAX_READ_CHARS = 50_000;

interface AgentFileEntry {
  id: number;
  title: string;
  description: string | null;
  filename: string;
  content_type: string | null;
  byte_size: number | null;
  signed_id: string | null;
  scope: "agent" | "org";
  created_at: string | null;
}

async function fetchFileList(agentId: number): Promise<AgentFileEntry[]> {
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) throw new Error("ENGINE_API_SECRET not set");
  const res = await fetch(`${railsInternalUrl()}/api/agent_files?agent_id=${agentId}`, {
    headers: { "X-Engine-Secret": secret },
  });
  if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files?: AgentFileEntry[] };
  return data.files ?? [];
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildFilesMcpServer(agentId: number, _orgId: number) {
  const listTool = tool(
    "list_files",
    "List the files available to you — your personal files plus the org-shared library. Each entry shows an id, title, type, and size, with a [personal/org] marker. " +
      "Use this to discover what reference material you have, then call read_file with an id to read a file's full contents. Prefer this over guessing when the user references 'the doc', 'the spec', 'the contract', etc.",
    {},
    async () => {
      try {
        const files = await fetchFileList(agentId);
        if (files.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No files are available yet. Ask the user to add files in the agent's Files tab (personal or org-shared).",
            }],
          };
        }
        const lines = files.map((f) => {
          const marker = f.scope === "org" ? "org" : "personal";
          const type = f.content_type || "unknown";
          return `[${f.id}] ${f.title} (${marker}, ${type}, ${fmtSize(f.byte_size)})${f.description ? ` — ${f.description}` : ""}`;
        });
        return {
          content: [{
            type: "text",
            text: `${files.length} file(s) available. Call read_file with an id to read one.\n\n${lines.join("\n")}`,
          }],
        };
      } catch (err) {
        logger.error("list_files failed", { error: (err as Error).message });
        return {
          content: [{ type: "text", text: `list_files error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  const readTool = tool(
    "read_file",
    "Read the full text contents of one of your files. Pass the file id from list_files. Extracts text from PDF, DOCX, HTML, Markdown, and plain-text files. Very large files are truncated.",
    {
      file_id: z.number().int().describe("The file id from list_files."),
    },
    async (args) => {
      try {
        const files = await fetchFileList(agentId);
        const entry = files.find((f) => f.id === args.file_id);
        if (!entry) {
          return {
            content: [{ type: "text", text: `File ${args.file_id} not found in your available files. Call list_files to see valid ids.` }],
            isError: true,
          };
        }
        if (!entry.signed_id) {
          return {
            content: [{ type: "text", text: `File "${entry.title}" has no downloadable content (no attachment).` }],
            isError: true,
          };
        }

        const res = await fetch(`${railsInternalUrl()}/api/blobs/${entry.signed_id}`);
        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Failed to download "${entry.title}": ${res.status}` }],
            isError: true,
          };
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        const extracted = await extractFromBytes(bytes, entry.filename, entry.content_type ?? undefined);
        const text = (extracted.text || "").trim();

        if (!text) {
          return {
            content: [{
              type: "text",
              text: `"${entry.title}" (${entry.content_type || "unknown type"}) contains no extractable text. Binary formats like images and spreadsheets can't be read as text yet.`,
            }],
          };
        }

        const truncated = text.length > MAX_READ_CHARS;
        const body = truncated ? text.slice(0, MAX_READ_CHARS) : text;
        const note = truncated
          ? `\n\n[... truncated — file is ${text.length} chars, showing first ${MAX_READ_CHARS}]`
          : "";

        return {
          content: [{
            type: "text",
            text: `File: "${entry.title}" (${entry.scope === "org" ? "org-shared" : "personal"})\n\n${body}${note}`,
          }],
        };
      } catch (err) {
        logger.error("read_file failed", { error: (err as Error).message });
        return {
          content: [{ type: "text", text: `read_file error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "files",
    version: "1.0.0",
    tools: [listTool, readTool],
  });
}
