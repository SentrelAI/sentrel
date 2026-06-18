// External OAuth-connected MCP servers (Meta Ads MCP, etc.). Rails owns the
// connection + token refresh; this module asks Rails for the agent's connected
// servers WITH a fresh Bearer token, lists each server's tools (so they can be
// added to the SDK allowlist), and turns them into SDK mcpServers entries.
//
// Provider-agnostic: anything the org connected via the MCP OAuth flow shows up
// here and gets attached to the agent — no per-provider code in the engine.

import { railsInternalUrl } from "../host/rails-url.js";
import { logger } from "../logger.js";

export interface ExternalMcpServer {
  name: string;        // slug used as the mcpServers key (e.g. "meta_ads")
  url: string;         // MCP endpoint
  transport: "http" | "sse" | "stdio";
  access_token: string;
}

export interface ExternalMcpWiring {
  // SDK mcpServers entries, keyed by slug.
  servers: Record<string, unknown>;
  // Fully-qualified tool names (mcp__<slug>__<tool>) for the allowlist — the
  // SDK won't let the agent call an MCP tool that isn't explicitly allowed.
  toolNames: string[];
}

async function fetchExternalMcpServers(agentId: number): Promise<ExternalMcpServer[]> {
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) return [];
  try {
    const res = await fetch(`${railsInternalUrl()}/api/mcp_servers?agent_id=${agentId}`, {
      headers: { "X-Engine-Secret": secret },
    });
    if (!res.ok) {
      logger.warn(`external MCP fetch failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { mcp_servers?: ExternalMcpServer[] };
    return data.mcp_servers ?? [];
  } catch (err) {
    logger.error("external MCP fetch network error", { error: (err as Error).message });
    return [];
  }
}

// A streamable-HTTP response can be plain JSON or an SSE stream with the
// JSON-RPC result in a `data:` line. Pull the last result/error object out.
function parseJsonRpc(text: string): any {
  const t = text.trimStart();
  if (t.startsWith("{")) { try { return JSON.parse(t); } catch { return null; } }
  const dataLines = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
  for (const d of dataLines.reverse()) {
    try { const j = JSON.parse(d); if (j && (j.result || j.error)) return j; } catch { /* keep scanning */ }
  }
  return null;
}

// Minimal MCP handshake over streamable HTTP to enumerate tool names.
async function listTools(url: string, token: string): Promise<string[]> {
  const base: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const post = (headers: Record<string, string>, body: unknown) =>
    fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  const initRes = await post(base, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sentrel", version: "1" } },
  });
  if (!initRes.ok) {
    logger.warn(`external MCP initialize failed: ${initRes.status}`);
    return [];
  }
  const sessionId = initRes.headers.get("mcp-session-id");
  await initRes.text(); // drain
  const headers = sessionId ? { ...base, "Mcp-Session-Id": sessionId } : base;

  // Required by spec before normal requests; ignore failures.
  await post(headers, { jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const listRes = await post(headers, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const json = parseJsonRpc(await listRes.text());
  const tools = (json?.result?.tools ?? []) as Array<{ name?: string }>;
  return tools.map((t) => t.name).filter((n): n is string => Boolean(n));
}

// Build SDK mcpServers entries + the allowlist tool names for the agent's
// connected external servers. HTTP/SSE get a Bearer header; stdio reserved.
export async function buildExternalMcpServers(agentId: number): Promise<ExternalMcpWiring> {
  const servers = await fetchExternalMcpServers(agentId);
  const out: Record<string, unknown> = {};
  const toolNames: string[] = [];

  for (const s of servers) {
    if (!s.access_token) continue;
    if (s.transport !== "http" && s.transport !== "sse") {
      logger.warn(`external MCP ${s.name}: transport "${s.transport}" not supported yet`);
      continue;
    }
    out[s.name] = {
      type: s.transport,
      url: s.url,
      headers: { Authorization: `Bearer ${s.access_token}` },
    };
    try {
      const names = await listTools(s.url, s.access_token);
      for (const n of names) toolNames.push(`mcp__${s.name}__${n}`);
      logger.info(`external MCP ${s.name}: ${names.length} tools`);
    } catch (err) {
      logger.warn(`external MCP ${s.name}: tools/list failed`, { error: (err as Error).message });
    }
  }

  if (Object.keys(out).length > 0) {
    logger.info(`external MCP: attached ${Object.keys(out).join(", ")} (${toolNames.length} tools)`);
  }
  return { servers: out, toolNames };
}
