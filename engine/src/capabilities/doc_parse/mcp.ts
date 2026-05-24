// Document parse MCP — mcp__doc__extract. Routes to llamaparse / mistral_ocr
// / reducto via the registry.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../../logger.js";
import { getActiveDocParseProvider } from "./registry.js";
import type { Agent } from "../../types.js";

export function buildDocParseMcpServer(agent: Agent) {
  const extractTool = tool(
    "extract",
    "Extract structured content from a document (PDF, docx, image scan, etc.). " +
      "Returns clean markdown (default), plain text, or structured JSON. Use this when the user sends " +
      "a contract / invoice / form / scanned doc and you need to reason about the contents — much better " +
      "than Read on the raw bytes.",
    {
      file_path: z.string().optional().describe("Path inside /data (workspace/inbox/<...>). One of file_path or url required."),
      url: z.string().url().optional().describe("Public URL to fetch. One of file_path or url required."),
      output_format: z.enum(["markdown", "text", "json"]).optional().describe("Default markdown — preserves headings, tables, lists. text strips formatting. json returns the provider's structured payload."),
    },
    async (args) => {
      if (!args.file_path && !args.url) {
        return { content: [{ type: "text" as const, text: "extract: provide file_path or url" }], isError: true };
      }
      try {
        const p = await getActiveDocParseProvider(agent);
        const out = await p.parse(args, agent.id);
        const preview = out.content.length > 8000
          ? `${out.content.slice(0, 8000)}\n\n[…truncated, ${out.content.length} total chars — call extract with output_format='json' or pass a narrower file_path to see specific sections.]`
          : out.content;
        return {
          content: [{
            type: "text" as const,
            text: `Extracted via ${p.name} (${out.format}${out.pages ? `, ${out.pages} pages` : ""}):\n\n${preview}`,
          }],
        };
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        logger.warn("doc_parse.extract failed", { error: msg });
        return { content: [{ type: "text" as const, text: `doc parse failed: ${msg}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "doc",
    version: "1.0.0",
    tools: [extractTool],
  });
}
