// Tavily — agent-native search. Returns clean curated results + optional
// snippet content. Free tier 1000 req/mo, paid from $30/mo.

import { fetchSecret } from "../../tools/secrets.js";
import type { WebSearchInput, WebSearchOutput } from "./types.js";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "tavily", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const TavilyProvider = {
  name: "tavily" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async search(input: WebSearchInput, agentId: number): Promise<WebSearchOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("tavily: no credential resolved");

    const body: Record<string, unknown> = {
      api_key: key,
      query: input.query,
      max_results: Math.min(input.max_results ?? 5, 20),
      search_depth: input.include_content ? "advanced" : "basic",
      include_raw_content: input.include_content ?? false,
    };
    if (input.topic === "news") body.topic = "news";
    if (input.days_back) body.days = input.days_back;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tavily search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const data = await res.json() as {
      answer?: string;
      results: Array<{ title: string; url: string; content?: string; raw_content?: string; published_date?: string; score?: number }>;
    };

    return {
      answer: data.answer,
      results: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        content: r.raw_content,
        published_at: r.published_date,
        score: r.score,
      })),
    };
  },
};
