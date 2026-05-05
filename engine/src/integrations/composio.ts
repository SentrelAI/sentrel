import { Composio } from "@composio/core";
import { ClaudeAgentSDKProvider } from "@composio/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { curatedToolsFor } from "./curated.js";
import { CircuitBreaker, CircuitOpenError } from "../lib/circuit-breaker.js";

// Extra N — circuit breaker on Composio API calls. If the API is slow/down,
// the agent falls back to baseline tools (no integrations) rather than
// blocking for the full HTTP timeout.
const composioBreaker = new CircuitBreaker("composio", {
  failThreshold: 3,
  cooldownMs: 30_000,
  timeoutMs: Number(process.env.COMPOSIO_TIMEOUT_MS || 5000),
});

// Creates a per-org Composio MCP server compatible with the Claude Agent SDK.
// Each org gets isolated connections — apps connected by org A are invisible
// to org B. The server is registered alongside our custom MCP servers
// (recall, send-media, scheduling, tasks) in agent-runner's buildQueryOptions.
//
// Context-aware tool loading (Step 2):
// - `relevantToolkits = []` → tiny server with only search meta-tool (~300 tokens)
// - `relevantToolkits = ["googlesheets"]` → only curated Google Sheets tools (~5 tools, ~2k tokens)
// - `relevantToolkits = undefined` → legacy behavior: load ALL connected toolkits (for backwards compat)

let composioClient: any = null;

function getClient(): any {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    logger.info("Composio: COMPOSIO_API_KEY not set, skipping integrations");
    return null;
  }
  if (!composioClient) {
    composioClient = new Composio({
      apiKey,
      provider: new ClaudeAgentSDKProvider(),
      dangerouslySkipVersionCheck: true,
    } as any);
  }
  return composioClient;
}

// Cache key: "org_<id>" or "org_<id>+user_<id>" — the union of buckets being
// queried. TTL 60s. Avoids hitting Composio on every agent run just to list
// connections.
const toolkitsCache = new Map<string, { toolkits: string[]; expiresAt: number }>();
const TOOLKITS_TTL_MS = 60_000;

// Build the Composio user_id list for a given run. Always includes the
// workspace bucket; optionally includes the originating user's personal
// bucket so user-scoped integrations (their personal Gmail, LinkedIn, etc.)
// merge with org-shared ones.
function composioUserIds(orgId: number, userId?: number | null): string[] {
  const ids = [`org_${orgId}`];
  if (userId) ids.push(`user_${userId}`);
  return ids;
}

// Cache key: same as toolkits but stores the per-toolkit owner mapping so
// tools.execute knows which user_id holds the connection. A toolkit can be
// connected as org-shared (owner = "org_<id>") OR personal (owner = "user_<id>").
// We prefer the user bucket when both exist so personal Gmail wins over a
// shared one, but Vercel-as-org-only correctly resolves to the org bucket.
const ownersCache = new Map<string, { owners: Map<string, string>; expiresAt: number }>();

export async function getActiveToolkits(orgId: number, userId?: number | null): Promise<string[]> {
  const owners = await getToolkitOwners(orgId, userId);
  return Array.from(owners.keys());
}

export async function getToolkitOwners(orgId: number, userId?: number | null): Promise<Map<string, string>> {
  const cacheKey = userId ? `org_${orgId}+user_${userId}` : `org_${orgId}`;
  const cached = ownersCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.owners;

  const client = getClient();
  if (!client) return new Map();
  try {
    const buckets = composioUserIds(orgId, userId); // ["org_X", "user_Y"]
    const owners = new Map<string, string>();

    // Composio 0.8's connectedAccounts.list response doesn't echo back the
    // user_id on each item, so we can't infer which bucket owns a connection
    // from a single call. List per bucket and tag accordingly. Personal
    // (user_*) buckets are queried last so they overwrite the org-shared
    // bucket entry — personal accounts win when both exist.
    for (const bucket of buckets) {
      const connections: any = await composioBreaker.call(() =>
        (client as any).connectedAccounts.list({ userIds: [bucket] }),
      );
      for (const c of connections.items || []) {
        if (c.status !== "ACTIVE") continue;
        const slug = c.toolkit?.slug;
        if (!slug) continue;
        owners.set(slug, bucket);
      }
    }
    toolkitsCache.set(cacheKey, { toolkits: Array.from(owners.keys()), expiresAt: Date.now() + TOOLKITS_TTL_MS });
    ownersCache.set(cacheKey, { owners, expiresAt: Date.now() + TOOLKITS_TTL_MS });
    return owners;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn("Composio: circuit OPEN, returning empty toolkits");
    } else {
      logger.error("Composio: failed to list toolkits", { error: (err as Error).message });
    }
    return new Map();
  }
}

export function invalidateToolkitsCache(orgId: number, userId?: number | null): void {
  if (userId) toolkitsCache.delete(`org_${orgId}+user_${userId}`);
  toolkitsCache.delete(`org_${orgId}`);
}

/**
 * Build the Composio MCP server for an agent run.
 *
 * - If `relevantToolkits` is provided and non-empty: load only curated tools
 *   for those specific toolkits (context-aware loading).
 * - If `relevantToolkits` is an empty array: return tiny server with only
 *   COMPOSIO_SEARCH_TOOLS for agent to find what it needs.
 * - If `relevantToolkits` is undefined: legacy — load all active toolkits.
 */
export async function getComposioMcpServer(
  orgId: number,
  relevantToolkits?: string[],
  userId?: number | null,
  policies?: import("./tool-acl.js").ToolPolicy[],
): Promise<{ server: any; toolkits: string[]; toolNames: string[] } | null> {
  const { indexPolicies, policyAllows, toolkitSlugFor } = await import("./tool-acl.js");
  const policyByToolkit = indexPolicies(policies || []);
  const client = getClient();
  if (!client) return null;

  try {
    const composioUserIdList = composioUserIds(orgId, userId);
    const primaryUserId = composioUserIdList[composioUserIdList.length - 1] ?? `org_${orgId}`;
    const owners = await getToolkitOwners(orgId, userId);
    const activeToolkits = Array.from(owners.keys());

    if (activeToolkits.length === 0) {
      logger.info(`Composio: no active connections for ${composioUserIdList.join(", ")}`);
      return null;
    }

    // Determine which toolkits to load
    const toolkitsToLoad = relevantToolkits !== undefined
      ? relevantToolkits.filter((t) => activeToolkits.includes(t))
      : activeToolkits;

    const toolsArr: any[] = [];
    // Track tool → owner so the per-tool execute handler can dispatch under
    // the same Composio entity that owns the connection (org_X vs user_X).
    const toolNameToOwner = new Map<string, string>();
    const ownerFor = (slug: string) => owners.get(slug) || primaryUserId;

    if (toolkitsToLoad.length === 0) {
      // Search-only mode: load meta-tool so agent can find integrations on demand
      try {
        const raw = await (client as any).tools.get(primaryUserId, { tools: ["COMPOSIO_SEARCH_TOOLS"] });
        const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
        for (const tool of arr) toolNameToOwner.set(tool.name, primaryUserId);
        toolsArr.push(...arr);
      } catch (err) {
        logger.warn("Composio: failed to load COMPOSIO_SEARCH_TOOLS meta-tool", { error: (err as Error).message });
      }
    } else {
      // Context-aware mode: load curated tools for matched toolkits, each
      // under the entity (org_X / user_X) that holds the toolkit's connection.
      for (const toolkit of toolkitsToLoad) {
        const curated = curatedToolsFor(toolkit);
        const tkOwner = ownerFor(toolkit);
        try {
          // Composio v3 rejects requests with BOTH `tools` and `toolkits`.
          // If we have curated tool names → use `tools` only (precise).
          // If no curated list → use `toolkits` (load all tools for that app).
          const params: any = curated.length > 0
            ? { tools: curated, limit: 20 }
            : { toolkits: [toolkit], limit: 20 };
          const raw = await (client as any).tools.get(tkOwner, params);
          const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
          for (const tool of arr) toolNameToOwner.set(tool.name, tkOwner);
          toolsArr.push(...arr);
        } catch (err) {
          logger.warn(`Composio: failed to load tools for ${toolkit} (owner=${tkOwner})`, { error: (err as Error).message });
        }
      }
    }

    if (!toolsArr || toolsArr.length === 0) {
      logger.info(`Composio: no tools loaded for ${primaryUserId} (relevant: ${toolkitsToLoad.join(", ") || "none"})`);
      return null;
    }

    // De-duplicate by tool name. Same tool can come back from multiple
    // tools.get() calls when curated lists overlap or when Composio echoes a
    // shared tool under multiple toolkits. Anthropic's Messages API rejects
    // the request with `tools: Tool names must be unique` if any duplicates
    // make it into the final tool list.
    const seen = new Set<string>();
    const dedupedToolsArr: any[] = [];
    for (const t of toolsArr as any[]) {
      const name = t?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      dedupedToolsArr.push(t);
    }
    if (dedupedToolsArr.length !== toolsArr.length) {
      logger.info(`Composio: dropped ${toolsArr.length - dedupedToolsArr.length} duplicate tool(s) before sending to model`);
    }

    // ACL pass: drop tools that this agent's policy rejects. The agent never
    // sees denied tools — cleaner than runtime PreToolUse blocks because the
    // agent can't even attempt the call.
    const beforeFilter = dedupedToolsArr.length;
    const filteredToolsArr = dedupedToolsArr.filter((t) => {
      const slug = toolkitSlugFor(t.name || "");
      const policy = policyByToolkit.get(slug);
      return policyAllows(policy, t.name || "");
    });
    const droppedCount = beforeFilter - filteredToolsArr.length;
    if (droppedCount > 0) {
      logger.info(`Composio ACL: dropped ${droppedCount}/${beforeFilter} tools per agent policy`);
    }
    if (filteredToolsArr.length === 0) {
      logger.warn("Composio ACL: every tool denied by policy — agent has no Composio surface");
      return null;
    }

    // Wrap handlers: Composio requires dangerouslySkipVersionCheck for "latest" tool version.
    const tools = (filteredToolsArr as any[]).map((t) => ({
      ...t,
      handler: async (args: any) => {
        // Use the Composio entity that owns this toolkit's connection. Calling
        // tools.execute under the wrong entity (e.g. user_X when the connection
        // is on org_X) returns "ActionExecute_ConnectedAccountNotFound".
        const ownerEntity = toolNameToOwner.get(t.name) || primaryUserId;
        try {
          const result = await (client as any).tools.execute(t.name, {
            userId: ownerEntity,
            arguments: args,
            dangerouslySkipVersionCheck: true,
          });
          // Composio's tools.execute returns a 200 even when the underlying
          // call failed — we need to inspect the body to surface the upstream
          // error to the agent (and to the engine logs).
          const successful = result?.successful ?? result?.successfull ?? true;
          if (successful === false) {
            const errMsg = result?.error || result?.message || JSON.stringify(result?.data ?? {}).slice(0, 500);
            logger.error(`Composio tool ${t.name} returned !successful`, { error: errMsg, raw: JSON.stringify(result).slice(0, 800) });
            return {
              content: [{ type: "text", text: `Tool ${t.name} failed: ${errMsg}` }],
              isError: true,
            };
          }
          return { content: [{ type: "text", text: JSON.stringify(result?.data ?? result, null, 2) }] };
        } catch (err: any) {
          // Composio wraps the actual upstream error in ComposioToolExecutionError
          // with the real APIError on `cause`. Walk the chain to pull out
          // status / response body so the agent sees "401 invalid_token" instead
          // of the useless top-level "Error executing the tool".
          const collect = (e: any, depth = 0): Record<string, unknown> => {
            if (!e || depth > 4) return {};
            const out: Record<string, unknown> = {};
            if (e.message) out.message = e.message;
            if (e.status || e.response?.status) out.status = e.status || e.response?.status;
            const body = e.error || e.response?.data || e.body || e.data;
            if (body) out.body = typeof body === "string" ? body.slice(0, 800) : JSON.stringify(body).slice(0, 800);
            const inner = e.cause ? collect(e.cause, depth + 1) : {};
            return { ...out, ...Object.fromEntries(Object.entries(inner).map(([k, v]) => [`cause_${k}`, v])) };
          };
          const detail = collect(err);
          const richErr = Object.entries(detail)
            .map(([k, v]) => `${k}=${v}`)
            .join(" | ") || "unknown error";
          logger.error(`Composio tool ${t.name} failed`, {
            ...detail,
            stack: err?.stack?.split("\n").slice(0, 3).join(" | "),
          });
          return {
            content: [{ type: "text", text: `Tool ${t.name} failed: ${richErr}` }],
            isError: true,
          };
        }
      },
    }));

    const server = createSdkMcpServer({
      name: "composio",
      version: "1.0.0",
      tools: tools as any,
    });

    const toolNames = tools.map((t) => t.name).filter(Boolean);
    const ownerSummary = Array.from(owners.entries())
      .filter(([slug]) => toolkitsToLoad.includes(slug))
      .map(([slug, e]) => `${slug}@${e}`)
      .join(", ");
    logger.info(
      `Composio: ${tools.length} tools loaded for ${composioUserIdList.join(", ")} (active: ${activeToolkits.join(", ")}; loaded: ${ownerSummary || "search-only"})`,
    );
    return { server, toolkits: activeToolkits, toolNames };
  } catch (err) {
    logger.error("Composio session failed", { error: (err as Error).message });
    return null;
  }
}

/**
 * Build a Composio MCP server for a specific set of toolkits.
 * Used by search_integrations to dynamically add tools mid-session via
 * Query.setMcpServers(). Returns just the server (no metadata wrapper).
 */
export async function buildComposioServerForToolkits(
  orgId: number,
  toolkits: string[],
): Promise<any | null> {
  const result = await getComposioMcpServer(orgId, toolkits);
  return result?.server ?? null;
}
