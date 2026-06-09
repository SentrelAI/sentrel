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

// Detect Composio "needs auth" / "not connected" / 401 / 403 in the
// collected error detail walked off the ComposioToolExecutionError chain.
// Different upstream APIs phrase this differently — we cast a wide net:
// status codes 401/403 always count, and any text containing
// connect/auth-related keywords across message + body fields.
function looksLikeAuthError(detail: Record<string, unknown>): boolean {
  const status = Number(detail.status ?? detail.cause_status ?? 0);
  if (status === 401 || status === 403) return true;
  const blob = Object.values(detail).map((v) => String(v ?? "")).join(" | ").toLowerCase();
  if (/connectedaccountnotfound|not connected|connection not found|no.*connection|needs.?auth|please.*connect|reconnect|invalid.?token|unauthori[sz]ed|authentication.?required|auth.?required/.test(blob)) {
    return true;
  }
  return false;
}

// Convert a raw toolkit slug into something readable for the connect card.
// "googlesheets" → "Google Sheets", "hubspot" → "HubSpot", "linkedin" →
// "LinkedIn". Falls back to capitalized slug for tools we don't have a
// custom mapping for.
function humanizeToolkit(slug: string): string {
  const KNOWN: Record<string, string> = {
    googlesheets: "Google Sheets",
    googledocs: "Google Docs",
    googledrive: "Google Drive",
    googlecalendar: "Google Calendar",
    gmail: "Gmail",
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    pipedrive: "Pipedrive",
    linkedin: "LinkedIn",
    twitter: "Twitter / X",
    slack: "Slack",
    notion: "Notion",
    stripe: "Stripe",
    airtable: "Airtable",
    asana: "Asana",
    trello: "Trello",
    github: "GitHub",
    gitlab: "GitLab",
    apollo: "Apollo",
    intercom: "Intercom",
    zendesk: "Zendesk",
    discord: "Discord",
  };
  return KNOWN[slug.toLowerCase()] || (slug.charAt(0).toUpperCase() + slug.slice(1));
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

// {slug → status} for every connected account in the org/user buckets,
// including REVOKED / EXPIRED / INACTIVE / INITIATED / FAILED. Used by
// the intent router to give the user a SPECIFIC error message when a
// needed toolkit isn't active: "your Apollo connection was revoked"
// is way more actionable than "Apollo is not connected" (which sounds
// like you never set it up — confusing when /integrations still shows
// it as connected).
const statusesCache = new Map<string, { statuses: Map<string, string>; expiresAt: number }>();

export async function getToolkitStatuses(orgId: number, userId?: number | null): Promise<Map<string, string>> {
  const cacheKey = userId ? `org_${orgId}+user_${userId}` : `org_${orgId}`;
  const cached = statusesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.statuses;

  const client = getClient();
  if (!client) return new Map();
  try {
    const buckets = composioUserIds(orgId, userId);
    const statuses = new Map<string, string>();
    for (const bucket of buckets) {
      const connections: any = await composioBreaker.call(() =>
        (client as any).connectedAccounts.list({ userIds: [bucket] }),
      );
      for (const c of connections.items || []) {
        const slug = c.toolkit?.slug;
        if (!slug) continue;
        // Prefer ACTIVE over non-ACTIVE if the same slug has both
        // (e.g. user has one revoked + one fresh).
        const existing = statuses.get(slug);
        if (existing === "ACTIVE") continue;
        statuses.set(slug, c.status || "UNKNOWN");
      }
    }
    statusesCache.set(cacheKey, { statuses, expiresAt: Date.now() + TOOLKITS_TTL_MS });
    return statuses;
  } catch (err) {
    if (!(err instanceof CircuitOpenError)) {
      logger.error("Composio: failed to list toolkit statuses", { error: (err as Error).message });
    }
    return new Map();
  }
}

export function invalidateToolkitsCache(orgId: number, userId?: number | null): void {
  const exactKeys = userId
    ? [`org_${orgId}`, `org_${orgId}+user_${userId}`]
    : [`org_${orgId}`];
  for (const key of exactKeys) {
    toolkitsCache.delete(key);
    ownersCache.delete(key);
    statusesCache.delete(key);
  }
  if (!userId) {
    for (const key of [...toolkitsCache.keys(), ...ownersCache.keys(), ...statusesCache.keys()]) {
      if (key.startsWith(`org_${orgId}+user_`)) {
        toolkitsCache.delete(key);
        ownersCache.delete(key);
        statusesCache.delete(key);
      }
    }
  }
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

          // Defensive check: if we asked Composio for N curated names
          // and got back fewer, log which names were silently dropped.
          // This was hiding the Apollo bug — curated.ts had wrong tool
          // names (e.g. APOLLO_SEARCH_PEOPLE doesn't exist; the real
          // one is APOLLO_PEOPLE_SEARCH) and Composio just returned
          // the valid ones with no error, leaving the agent without
          // people-search capability for weeks.
          if (curated.length > 0 && arr.length < curated.length) {
            const returnedNames = new Set(arr.map((t: any) => t.name));
            const dropped = curated.filter((name) => !returnedNames.has(name));
            if (dropped.length > 0) {
              logger.warn(
                `Composio: ${toolkit} dropped ${dropped.length}/${curated.length} curated tools — names invalid? ${dropped.join(", ")}`,
              );
            }
          }

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
          // Detect Composio "needs auth" failures and proactively surface a
          // Connect <toolkit> card to the user instead of leaving the agent
          // staring at a 401. The agent's system prompt tells it to wait
          // when a tool returns needs_auth — no retry loop. Best-effort:
          // emitting the card is fire-and-forget; the tool result still
          // reads as a normal isError so the agent can also call out the
          // problem in prose.
          const isAuthError = looksLikeAuthError(detail);
          if (isAuthError) {
            const slug = toolkitSlugFor(t.name || "");
            try {
              const { emitConnectionProposal } = await import("../gateway.js");
              emitConnectionProposal({
                service: slug,
                label: humanizeToolkit(slug),
                why: `${t.name} needs ${slug} to be connected before it can run`,
              });
              logger.info(`Composio: emitted connection_proposal for ${slug} after auth failure on ${t.name}`);
            } catch (cpErr) {
              logger.warn("Failed to emit connection_proposal", { error: (cpErr as Error).message });
            }
            return {
              content: [{ type: "text", text: `Tool ${t.name} needs auth: ${slug} is not connected for this agent. The user is being asked to connect — wait for them to act, do not retry.` }],
              isError: true,
            };
          }
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
  userId?: number | null,
): Promise<any | null> {
  const result = await getComposioMcpServer(orgId, toolkits, userId);
  return result?.server ?? null;
}
