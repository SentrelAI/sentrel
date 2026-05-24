// EXA — semantic / neural search. Best when the agent is looking for
// "things that look like this" (e.g. similar papers, similar companies).

import { fetchSecret } from "../../tools/secrets.js";
import type { WebSearchInput, WebSearchOutput } from "./types.js";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "exa", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const ExaProvider = {
  name: "exa" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async search(input: WebSearchInput, agentId: number): Promise<WebSearchOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("exa: no credential resolved");

    const body: Record<string, unknown> = {
      query: input.query,
      type: "neural",
      numResults: Math.min(input.max_results ?? 5, 20),
    };
    if (input.days_back) {
      const since = new Date(Date.now() - input.days_back * 86400_000).toISOString().slice(0, 10);
      body.startPublishedDate = since;
    }
    if (input.include_content) body.contents = { text: true };

    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`exa search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const data = await res.json() as {
      results: Array<{ title: string; url: string; text?: string; publishedDate?: string; score?: number }>;
    };
    return {
      results: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.text?.slice(0, 500),
        content: r.text,
        published_at: r.publishedDate,
        score: r.score,
      })),
    };
  },
};
