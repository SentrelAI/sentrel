// Web search registry. Preference (agent-friendliness-first):
//   Tavily → EXA → Perplexity

import { TavilyProvider } from "./tavily.js";
import { ExaProvider } from "./exa.js";
import { PerplexityProvider } from "./perplexity.js";
import { resolveCapabilities } from "../../capabilities.js";
import type { Agent } from "../../types.js";

type WebSearchProvider =
  | typeof TavilyProvider
  | typeof ExaProvider
  | typeof PerplexityProvider;

const REGISTRY: ReadonlyArray<WebSearchProvider> = [
  TavilyProvider,
  ExaProvider,
  PerplexityProvider,
];

export async function getActiveWebSearchProvider(agent: Agent): Promise<WebSearchProvider> {
  const cap = resolveCapabilities(agent).web_search;
  const desired = cap.provider || "auto";

  if (desired !== "auto") {
    const explicit = REGISTRY.find((p) => p.name === desired);
    if (!explicit) throw new Error(`web_search provider "${desired}" not registered`);
    if (!(await explicit.isAvailable(agent.id))) {
      throw new Error(`web_search provider "${desired}" unavailable — add a credential at /settings/credentials.`);
    }
    return explicit;
  }
  for (const p of REGISTRY) {
    if (await p.isAvailable(agent.id)) return p;
  }
  throw new Error("web_search: no provider available — add a key for tavily / exa / perplexity at /settings/credentials.");
}

export const WEB_SEARCH_REGISTRY = REGISTRY;
