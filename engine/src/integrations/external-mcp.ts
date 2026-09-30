// Remote MCP servers the workspace connected (Linear, ScribeMD, Meta Ads…).
// Rails owns sign-in, token storage and refresh; this module bridges each
// server into the agent's run with the official MCP SDK client:
//
//   remote server ⇄ SDK Client (Streamable HTTP or SSE; our fetch adds the Bearer)
//                 ⇄ in-process MCP server the Agent SDK mounts as mcp__<slug>__*
//
// Bridging, rather than handing the Agent SDK the URL and a static header, is
// what lets a run survive auth trouble and respect tool hints:
//   - 401: ask Rails to refresh once and retry; still 401 → the user signs in
//     again (card in the chat).
//   - 403 insufficient_scope: sign in again asking for the missing scope.
//   - destructiveHint tools wait for a human's OK; readOnlyHint tools don't.
//   - tools/list goes through verbatim (name, description, inputSchema,
//     annotations) and isError results reach the model as written.
//
// OAuth servers are per user: a run gets the sign-in of the user it acts for
// (job.payload.user_id); a run with nobody behind it gets workspace servers only.

import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { railsInternalUrl } from "../host/rails-url.js";
import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { createActionApproval } from "../security/action-approval.js";
import { emitActionApproval } from "../gateway.js";
import { postProposal } from "../tools/connections.js";
import type { Origin } from "../channels/origin-delivery.js";

export interface ExternalMcpServer {
  id: number;
  name: string;        // slug — the mcpServers key (e.g. "scribemd")
  label: string;       // display name
  url: string;         // MCP endpoint
  transport: "http" | "sse" | "stdio";
  auth_mode: "oauth" | "token" | "none";
  access_token: string | null; // null → a public server that takes no auth
}

export interface ExternalMcpContext {
  agentId: number;
  orgId: number;
  userId: number | null; // the user this run acts for, if any
  origin?: Origin;
}

export interface ExternalMcpWiring {
  // SDK mcpServers entries (in-process bridges), keyed by slug.
  servers: Record<string, { type: "sdk"; name: string; instance: McpServer }>;
  // Fully-qualified tool names (mcp__<slug>__<tool>) for the allowlist — the
  // SDK won't let the agent call an MCP tool that isn't explicitly allowed.
  toolNames: string[];
}

// ── Rails ──────────────────────────────────────────────────────────────────

async function rails(path: string, init: RequestInit = {}): Promise<Response | null> {
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) return null;
  try {
    return await fetch(`${railsInternalUrl()}${path}`, {
      ...init,
      headers: { "X-Engine-Secret": secret, "Content-Type": "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn(`external MCP: Rails ${path} failed`, { error: (err as Error).message });
    return null;
  }
}

async function fetchExternalMcpServers(ctx: ExternalMcpContext): Promise<ExternalMcpServer[]> {
  const user = ctx.userId ? `&user_id=${ctx.userId}` : "";
  const res = await rails(`/api/mcp_servers?agent_id=${ctx.agentId}${user}`);
  if (!res?.ok) {
    if (res) logger.warn(`external MCP fetch failed: ${res.status}`);
    return [];
  }
  const data = (await res.json()) as { mcp_servers?: ExternalMcpServer[] };
  return data.mcp_servers ?? [];
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

// ── One signed-in session with one server ─────────────────────────────────

// WWW-Authenticate: Bearer error="insufficient_scope", scope="mcp:read mcp:write"
function challengeParam(header: string, name: string): string | null {
  const m = header.match(new RegExp(`(?:^|[\\s,])${name}="([^"]*)"`));
  return m?.[1] ?? null;
}

class RemoteSession {
  token: string | null;
  // Set when the server refused us in a way only the user can fix.
  needsSignIn = false;
  missingScope: string | null = null;

  // ctx is refreshed each run: the same user's session can serve a chat run
  // and later a resumed one, and cards must reach the current run's channel.
  constructor(readonly server: ExternalMcpServer, public ctx: ExternalMcpContext) {
    this.token = server.access_token;
  }

  private withAuth(init?: RequestInit): RequestInit {
    const headers = new Headers(init?.headers);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    return { ...init, headers };
  }

  // The SDK transport's fetch: adds the Bearer; on a 401 asks Rails to refresh
  // once and retries the same request; notes the 403s only a sign-in fixes.
  fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    let res = await fetch(url, this.withAuth(init));

    if (res.status === 401 && this.server.auth_mode === "oauth" && this.token && this.ctx.userId) {
      await res.body?.cancel().catch(() => {});
      const refreshed = await this.refresh(this.token);
      if (refreshed) {
        this.token = refreshed;
        res = await fetch(url, this.withAuth(init));
      }
      if (res.status === 401) {
        this.needsSignIn = true;
        await this.report({ kind: "unauthorized" });
      }
    } else if (res.status === 401) {
      this.needsSignIn = true;
    }

    if (res.status === 403) {
      const challenge = res.headers.get("www-authenticate") ?? "";
      if (challengeParam(challenge, "error") === "insufficient_scope") {
        this.missingScope = challengeParam(challenge, "scope") ?? "";
        if (this.server.auth_mode === "oauth") await this.report({ kind: "insufficient_scope", scope: this.missingScope });
      }
    }
    return res;
  };

  private async refresh(rejected: string): Promise<string | null> {
    const res = await rails(`/api/mcp_servers/${this.server.id}/refresh`, {
      method: "POST",
      body: JSON.stringify({ agent_id: this.ctx.agentId, user_id: this.ctx.userId, rejected_digest: digest(rejected) }),
    });
    if (!res?.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  }

  private async report(body: { kind: "unauthorized" | "insufficient_scope"; scope?: string }) {
    await rails(`/api/mcp_servers/${this.server.id}/auth_error`, {
      method: "POST",
      body: JSON.stringify({ agent_id: this.ctx.agentId, user_id: this.ctx.userId, ...body }),
    });
  }
}

// ── Client cache ───────────────────────────────────────────────────────────

// One live client per (server, user), reused across runs — Rails hands us a
// current token each run, and a client that stops answering is replaced.
interface Live { session: RemoteSession; client: Client; tools: Tool[] }
const live = new Map<string, Live>();
const MAX_LIVE = 20;

async function connect(session: RemoteSession): Promise<Live> {
  const url = new URL(session.server.url);
  const transport = session.server.transport === "sse"
    ? new SSEClientTransport(url, { fetch: session.fetch })
    : new StreamableHTTPClientTransport(url, { fetch: session.fetch });
  const client = new Client({ name: "sentrel", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport); // initialize → notifications/initialized
  return { session, client, tools: await listAllTools(client) };
}

async function listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor && tools.length < 1000);
  return tools;
}

async function liveFor(server: ExternalMcpServer, ctx: ExternalMcpContext): Promise<Live> {
  const key = `${server.id}:${ctx.userId ?? "-"}:${server.url}`;
  const cached = live.get(key);
  if (cached) {
    cached.session.token = server.access_token;
    cached.session.ctx = ctx;
    cached.session.needsSignIn = false;
    cached.session.missingScope = null;
    try {
      cached.tools = await listAllTools(cached.client);
      return cached;
    } catch (err) {
      logger.info(`external MCP ${server.name}: reconnecting (${(err as Error).message})`);
      live.delete(key);
      cached.client.close().catch(() => {});
    }
  }
  const fresh = await connect(new RemoteSession(server, ctx));
  live.set(key, fresh);
  if (live.size > MAX_LIVE) {
    const [oldestKey, oldest] = live.entries().next().value as [string, Live];
    live.delete(oldestKey);
    oldest.client.close().catch(() => {});
  }
  return fresh;
}

// ── Tool calls ─────────────────────────────────────────────────────────────

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], isError });

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// Tools that declare destructiveHint wait for a human; everything else runs.
// The key ties an approval to this exact call, so a run resumed after the
// card can make it once — and only it.
async function approveDestructive(
  entry: Live,
  tool: Tool,
  args: Record<string, unknown>,
): Promise<CallToolResult | null> {
  const { server, ctx } = entry.session;
  const callKey = digest(stableStringify([server.id, tool.name, args])).slice(0, 32);
  if (await host.consumeApprovedToolCall(ctx.agentId, callKey)) return null;

  const summary = `Run ${tool.annotations?.title || tool.title || tool.name} on ${server.label}`;
  const payload = {
    server: server.label,
    tool: tool.name,
    description: (tool.description || "").slice(0, 600),
    arguments: args,
    _call_key: callKey,
  };
  const options = [{ label: "Run it", value: "approve" }, { label: "Don't run", value: "reject" }];
  const { id, promise } = createActionApproval(summary, "mcp_tool_call");
  await host.createPendingActionApproval({
    orgId: ctx.orgId, agentId: ctx.agentId, summary, payloadType: "mcp_tool_call", payload, options,
    riskTier: "high", approvalToken: id, allowAmendment: false, origin: ctx.origin,
  });
  emitActionApproval({ approvalToken: id, summary, payloadType: "mcp_tool_call", payload, options, riskTier: "high", allowAmendment: false });

  const decision = await promise;
  if (decision.value === "approve") {
    await host.consumeApprovedToolCall(ctx.agentId, callKey).catch(() => false);
    return null;
  }
  if (decision.value === "pending") {
    return text(
      `${tool.name} changes data in ${server.label}, so it needs the user's OK — the approval card is in the chat. ` +
      `END YOUR TURN NOW: tell them in one line what you're waiting on. When they approve you'll be woken; call ` +
      `${tool.name} again with the same arguments then.`,
      true,
    );
  }
  return text(`The user declined running ${tool.name} on ${server.label}. Don't retry it; offer an alternative if there is one.`, true);
}

// A long job answers { "status": "running", "next": … }: point the agent at
// the tool that keeps waiting instead of letting it call the work done.
function withRunningHint(result: CallToolResult, entry: Live, slug: string): CallToolResult {
  let body: Record<string, unknown> | null = (result.structuredContent as Record<string, unknown>) ?? null;
  if (!body) {
    const first = result.content?.find((c) => c.type === "text") as { text?: string } | undefined;
    try { body = first?.text ? JSON.parse(first.text) : null; } catch { body = null; }
  }
  if (!body || body.status !== "running") return result;

  const next = body.next as unknown;
  const nextTool = typeof next === "string" ? next
    : next && typeof next === "object" ? ((next as { tool?: string; name?: string }).tool ?? (next as { name?: string }).name)
    : undefined;
  const known = nextTool && entry.tools.some((t) => t.name === nextTool);
  const hint = known
    ? `Still running — call mcp__${slug}__${nextTool} (as its "next" hint says) to keep waiting. It isn't finished or failed.`
    : `Still running — follow its "next" hint to keep waiting. It isn't finished or failed.`;
  return { ...result, content: [...(result.content ?? []), { type: "text", text: hint }] };
}

// Auth failures only the user can fix become a sign-in card plus a result
// that tells the model what happened.
async function authFailure(entry: Live): Promise<CallToolResult | null> {
  const { server, ctx } = entry.session;
  const scope = entry.session.missingScope;
  if (!entry.session.needsSignIn && scope === null) return null;
  if (server.auth_mode !== "oauth") {
    return text(`${server.label} rejected the workspace's access token. Someone needs to reconnect it on the Integrations page.`, true);
  }
  const why = scope ? `${server.label} needs more access (${scope || "additional scope"})` : `sign in to ${server.label} again`;
  await postProposal({
    ctx: { agentId: ctx.agentId, orgId: ctx.orgId, origin: ctx.origin },
    slug: server.name, label: server.label, why, kind: "mcp", url: server.url,
  }).catch(() => {});
  return text(
    `${server.label} needs the user to ${scope ? `grant more access (${scope})` : "sign in again"}. A sign-in card is now in the chat. ` +
    `Tell them in one line and end your turn — you'll be resumed once they've signed in. Don't call propose_mcp_connection yourself.`,
    true,
  );
}

async function callTool(entry: Live, slug: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = entry.tools.find((t) => t.name === name);
  if (!tool) return text(`${entry.session.server.label} has no tool named ${name}.`, true);

  if (tool.annotations?.destructiveHint === true && tool.annotations?.readOnlyHint !== true) {
    const blocked = await approveDestructive(entry, tool, args);
    if (blocked) return blocked;
  }

  entry.session.needsSignIn = false;
  entry.session.missingScope = null;
  try {
    const result = (await entry.client.callTool({ name, arguments: args })) as CallToolResult;
    // isError results are written for the model — pass them through as-is.
    return withRunningHint(result, entry, slug);
  } catch (err) {
    const auth = await authFailure(entry);
    if (auth) return auth;
    const status = err instanceof StreamableHTTPError ? ` (HTTP ${err.code})` : "";
    logger.warn(`external MCP ${slug}.${name} failed${status}`, { error: (err as Error).message });
    return text(`Calling ${name} on ${entry.session.server.label} failed${status}: ${(err as Error).message}`, true);
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────

function bridge(entry: Live): McpServer {
  const slug = entry.session.server.name;
  const mcp = new McpServer({ name: slug, version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: entry.tools }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(entry, slug, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
  return mcp;
}

export async function buildExternalMcpServers(ctx: ExternalMcpContext): Promise<ExternalMcpWiring> {
  const servers = await fetchExternalMcpServers(ctx);
  const out: ExternalMcpWiring["servers"] = {};
  const toolNames: string[] = [];

  for (const s of servers) {
    if (s.transport !== "http" && s.transport !== "sse") {
      logger.warn(`external MCP ${s.name}: transport "${s.transport}" not supported yet`);
      continue;
    }
    try {
      const entry = await liveFor(s, ctx);
      out[s.name] = { type: "sdk", name: s.name, instance: bridge(entry) };
      for (const t of entry.tools) toolNames.push(`mcp__${s.name}__${t.name}`);
      logger.info(`external MCP ${s.name}: ${entry.tools.length} tools`);
    } catch (err) {
      // Includes a sign-in the user has to redo: the session already told Rails.
      logger.warn(`external MCP ${s.name}: unavailable this run`, { error: (err as Error).message });
    }
  }

  if (Object.keys(out).length > 0) {
    logger.info(`external MCP: attached ${Object.keys(out).join(", ")} (${toolNames.length} tools)`);
  }
  return { servers: out, toolNames };
}
