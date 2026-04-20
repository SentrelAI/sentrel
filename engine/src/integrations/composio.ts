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

// Cache: orgId → list of active toolkit slugs. TTL 60s. Avoids hitting
// Composio API on every agent run just to list connections.
const toolkitsCache = new Map<number, { toolkits: string[]; expiresAt: number }>();
const TOOLKITS_TTL_MS = 60_000;

export async function getActiveToolkits(orgId: number): Promise<string[]> {
  const cached = toolkitsCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.toolkits;

  const client = getClient();
  if (!client) return [];
  try {
    const userId = `org_${orgId}`;
    const connections: any = await composioBreaker.call(() =>
      (client as any).connectedAccounts.list({ userIds: [userId] }),
    );
    const toolkits = Array.from(new Set(
      (connections.items || [])
        .filter((c: any) => c.status === "ACTIVE")
        .map((c: any) => c.toolkit?.slug)
        .filter(Boolean),
    )) as string[];
    toolkitsCache.set(orgId, { toolkits, expiresAt: Date.now() + TOOLKITS_TTL_MS });
    return toolkits;
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn("Composio: circuit OPEN, returning empty toolkits");
    } else {
      logger.error("Composio: failed to list toolkits", { error: (err as Error).message });
    }
    return [];
  }
}

export function invalidateToolkitsCache(orgId: number): void {
  toolkitsCache.delete(orgId);
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
): Promise<{ server: any; toolkits: string[]; toolNames: string[] } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const userId = `org_${orgId}`;
    const activeToolkits = await getActiveToolkits(orgId);

    if (activeToolkits.length === 0) {
      logger.info(`Composio: no active connections for ${userId}`);
      return null;
    }

    // Determine which toolkits to load
    const toolkitsToLoad = relevantToolkits !== undefined
      ? relevantToolkits.filter((t) => activeToolkits.includes(t))
      : activeToolkits;

    const toolsArr: any[] = [];

    if (toolkitsToLoad.length === 0) {
      // Search-only mode: load meta-tool so agent can find integrations on demand
      try {
        const raw = await (client as any).tools.get(userId, { tools: ["COMPOSIO_SEARCH_TOOLS"] });
        const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
        toolsArr.push(...arr);
      } catch (err) {
        logger.warn("Composio: failed to load COMPOSIO_SEARCH_TOOLS meta-tool", { error: (err as Error).message });
      }
    } else {
      // Context-aware mode: load curated tools for matched toolkits
      for (const toolkit of toolkitsToLoad) {
        const curated = curatedToolsFor(toolkit);
        try {
          // Composio v3 rejects requests with BOTH `tools` and `toolkits`.
          // If we have curated tool names → use `tools` only (precise).
          // If no curated list → use `toolkits` (load all tools for that app).
          const params: any = curated.length > 0
            ? { tools: curated, limit: 20 }
            : { toolkits: [toolkit], limit: 20 };
          const raw = await (client as any).tools.get(userId, params);
          const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
          toolsArr.push(...arr);
        } catch (err) {
          logger.warn(`Composio: failed to load tools for ${toolkit}`, { error: (err as Error).message });
        }
      }
    }

    if (!toolsArr || toolsArr.length === 0) {
      logger.info(`Composio: no tools loaded for ${userId} (relevant: ${toolkitsToLoad.join(", ") || "none"})`);
      return null;
    }

    // Wrap handlers: Composio requires dangerouslySkipVersionCheck for "latest" tool version.
    const tools = (toolsArr as any[]).map((t) => ({
      ...t,
      handler: async (args: any) => {
        try {
          const result = await (client as any).tools.execute(t.name, {
            userId,
            arguments: args,
            dangerouslySkipVersionCheck: true,
          });
          return { content: [{ type: "text", text: JSON.stringify(result?.data ?? result, null, 2) }] };
        } catch (err: any) {
          logger.error(`Composio tool ${t.name} failed`, { error: err?.message });
          return {
            content: [{ type: "text", text: `Tool ${t.name} failed: ${err?.message || "unknown error"}` }],
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
    logger.info(
      `Composio: ${tools.length} tools loaded for ${userId} (active: ${activeToolkits.join(", ")}; loaded: ${toolkitsToLoad.join(", ") || "search-only"})`,
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
