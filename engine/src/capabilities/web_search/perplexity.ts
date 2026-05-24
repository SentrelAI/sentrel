// Perplexity Sonar — search-grounded generation. Returns an answer with
// citations alongside the raw result list. Good when the agent wants
// "what's the current state of X" without orchestrating search-then-read.

import { fetchSecret } from "../../tools/secrets.js";
import type { WebSearchInput, WebSearchOutput } from "./types.js";

const DEFAULT_MODEL = "sonar";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "perplexity", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const PerplexityProvider = {
  name: "perplexity" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async search(input: WebSearchInput, agentId: number): Promise<WebSearchOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("perplexity: no credential resolved");

    const body: Record<string, unknown> = {
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: "Answer the user's question briefly. Cite sources." },
        { role: "user", content: input.query },
      ],
      return_related_questions: false,
      search_recency_filter: input.days_back && input.days_back <= 7 ? "week" :
                             input.days_back && input.days_back <= 31 ? "month" :
                             input.days_back && input.days_back <= 365 ? "year" : undefined,
    };

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`perplexity failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
      search_results?: Array<{ title: string; url: string; date?: string }>;
    };
    const answer = data.choices[0]?.message?.content;
    const sources = data.search_results || (data.citations || []).map((url) => ({ title: url, url }));
    return {
      answer,
      results: sources.slice(0, input.max_results ?? 5).map((s) => ({
        title: s.title || s.url,
        url: s.url,
        published_at: (s as { date?: string }).date,
      })),
    };
  },
};
