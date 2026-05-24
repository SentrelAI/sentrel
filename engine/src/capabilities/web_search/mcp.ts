// Web search MCP — exposes mcp__search__web. Provider routing
// (tavily / exa / perplexity) happens via the registry.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../../logger.js";
import { getActiveWebSearchProvider } from "./registry.js";
import type { Agent } from "../../types.js";

export function buildWebSearchMcpServer(agent: Agent) {
  const searchTool = tool(
    "web",
    "Search the web for fresh information using a managed search provider (Tavily / EXA / Perplexity). " +
      "Use this when the built-in WebSearch tool isn't returning what you need, or when you want a curated, " +
      "citation-friendly result set (Perplexity returns an answer with sources alongside the raw hits).",
    {
      query: z.string().describe("The search query. Be specific — phrase it like a human asking a research librarian."),
      max_results: z.number().int().min(1).max(20).optional().describe("Default 5."),
      days_back: z.number().int().min(1).max(365).optional().describe("Filter to results from the last N days. Use for time-sensitive queries."),
      topic: z.enum(["general", "news", "academic"]).optional().describe("Bias the search (Tavily supports 'news')."),
      include_content: z.boolean().optional().describe("Ask the provider for full-page snippets (slower, costs more)."),
    },
    async (args) => {
      try {
        const p = await getActiveWebSearchProvider(agent);
        const out = await p.search(args, agent.id);
        const lines: string[] = [];
        if (out.answer) lines.push(`Answer (via ${p.name}):\n${out.answer}\n`);
        lines.push(`Results (${out.results.length}):`);
        for (const [i, r] of out.results.entries()) {
          lines.push(`${i + 1}. ${r.title}\n   ${r.url}${r.published_at ? ` · ${r.published_at}` : ""}${r.snippet ? `\n   ${r.snippet.slice(0, 280)}` : ""}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        logger.warn("web_search failed", { error: msg });
        return { content: [{ type: "text" as const, text: `web search failed: ${msg}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "search",
    version: "1.0.0",
    tools: [searchTool],
  });
}
