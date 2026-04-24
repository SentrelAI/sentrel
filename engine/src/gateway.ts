import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { redis } from "./queue.js";

const PORT = parseInt(process.env.GATEWAY_PORT || "3300");

// Connected clients
const clients = new Set<WebSocket>();

let wss: WebSocketServer;

// Sync callback — set by main.ts so the gateway doesn't need to know about
// agent loading, workspace sync, etc. Keeps the gateway independent.
let onSyncRequested: (() => Promise<void>) | null = null;
export function setSyncHandler(handler: () => Promise<void>): void {
  onSyncRequested = handler;
}

export function startGateway(): void {
  // HTTP server for REST endpoints + WebSocket upgrade
  const server = http.createServer(async (req, res) => {
    // CORS headers for browser access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sync — trigger config reload from Host
    if (req.method === "POST" && req.url === "/sync") {
      try {
        if (onSyncRequested) {
          await onSyncRequested();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "synced", timestamp: Date.now() }));
          logger.info("Gateway: config sync triggered via POST /sync");
        } else {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sync handler not registered" }));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
        logger.error("Gateway: sync failed", { error: (err as Error).message });
      }
      return;
    }

    // POST /rag/ingest — accepts raw uploads. Two modes:
    //   1) multipart/form-data with a "file" part + fields (agent_id, title)
    //      → engine extracts text based on filename/content-type, ingests.
    //   2) application/json with { agent_id, title, content, source_url? }
    //      → text was pre-extracted (URL fetch or pasted text).
    if (req.method === "POST" && req.url === "/rag/ingest") {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret || req.headers["x-engine-secret"] !== secret) {
        res.writeHead(401); res.end(); return;
      }
      try {
        const ct = (req.headers["content-type"] || ""); // preserve case — boundary is case-sensitive
        let result: any;

        if (ct.toLowerCase().startsWith("multipart/form-data")) {
          const { parseMultipart } = await import("./rag/multipart.js");
          const { extractFromBytes } = await import("./rag/extractor.js");
          const { ingestDocument } = await import("./rag/ingest.js");

          const parsed = await parseMultipart(req, ct);
          const file = parsed.files[0];
          if (!file) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "No file part in upload" }));
            return;
          }
          const agentIdParam = parsed.fields.agent_id;
          const orgIdParam   = parsed.fields.org_id;
          if (!agentIdParam && !orgIdParam) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing agent_id or org_id" }));
            return;
          }
          const scopeArg = agentIdParam
            ? { agentId: parseInt(agentIdParam) }
            : { orgId: parseInt(orgIdParam!) };
          const title = parsed.fields.title || file.filename || "Untitled";
          const extracted = await extractFromBytes(file.data, file.filename, file.contentType);
          result = await ingestDocument({
            ...scopeArg,
            title,
            sourceType: extracted.sourceType,
            content: extracted.text,
            metadata: {
              original_filename: file.filename,
              content_type: file.contentType,
              size_bytes: file.data.length,
            },
          });
        } else {
          // JSON path — pre-extracted text (URL fetch, raw paste)
          const body = await readJsonBody(req);
          const { ingestDocument } = await import("./rag/ingest.js");
          const scopeArg = body.org_id
            ? { orgId: Number(body.org_id) }
            : { agentId: Number(body.agent_id) };
          result = await ingestDocument({
            ...scopeArg,
            title: body.title,
            sourceType: body.source_type || "text",
            sourceUrl: body.source_url,
            content: body.content,
            metadata: body.metadata,
          });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
        logger.error("RAG ingest failed", { error: (err as Error).message });
      }
      return;
    }

    // POST /rag/ingest/url — fetch a URL and ingest its content
    if (req.method === "POST" && req.url === "/rag/ingest/url") {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret || req.headers["x-engine-secret"] !== secret) {
        res.writeHead(401); res.end(); return;
      }
      try {
        const body = await readJsonBody(req);
        const urlRes = await fetch(body.url);
        if (!urlRes.ok) throw new Error(`URL fetch failed: ${urlRes.status}`);
        const bytes = Buffer.from(await urlRes.arrayBuffer());
        const filename = body.url.split("/").pop() || "page.html";
        const { extractFromBytes } = await import("./rag/extractor.js");
        const { ingestDocument } = await import("./rag/ingest.js");
        const extracted = await extractFromBytes(bytes, filename, urlRes.headers.get("content-type") || undefined);
        const scopeArg = body.org_id
          ? { orgId: Number(body.org_id) }
          : { agentId: Number(body.agent_id) };
        const result = await ingestDocument({
          ...scopeArg,
          title: body.title || body.url,
          sourceType: extracted.sourceType,
          sourceUrl: body.url,
          content: extracted.text,
          metadata: { fetched_at: new Date().toISOString() },
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
        logger.error("RAG URL ingest failed", { error: (err as Error).message });
      }
      return;
    }

    // GET /rag/documents?agent_id=N  (personal KB)
    // GET /rag/documents?org_id=N    (org-shared KB — every agent in the org searches it)
    if (req.method === "GET" && req.url?.startsWith("/rag/documents")) {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret || req.headers["x-engine-secret"] !== secret) {
        res.writeHead(401); res.end(); return;
      }
      try {
        const url = new URL(req.url, "http://localhost");
        const { listDocuments, agentScope, orgScope } = await import("./rag/store.js");
        const agentIdParam = url.searchParams.get("agent_id");
        const orgIdParam   = url.searchParams.get("org_id");
        const scope = orgIdParam
          ? orgScope(parseInt(orgIdParam))
          : agentScope(parseInt(agentIdParam || "0"));
        const docs = await listDocuments(scope);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ documents: docs, scope: `${scope.kind}:${scope.id}` }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // DELETE /rag/documents/:id?agent_id=N  (or ?org_id=N)
    if (req.method === "DELETE" && req.url?.startsWith("/rag/documents/")) {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret || req.headers["x-engine-secret"] !== secret) {
        res.writeHead(401); res.end(); return;
      }
      try {
        const url = new URL(req.url, "http://localhost");
        const docId = parseInt(url.pathname.split("/").pop() || "0");
        const { deleteDocument, agentScope, orgScope } = await import("./rag/store.js");
        const agentIdParam = url.searchParams.get("agent_id");
        const orgIdParam   = url.searchParams.get("org_id");
        const scope = orgIdParam
          ? orgScope(parseInt(orgIdParam))
          : agentScope(parseInt(agentIdParam || "0"));
        await deleteDocument(scope, docId);
        res.writeHead(204); res.end();
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // GET /health — engine health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        agentId: config.employeeId,
        uptime: process.uptime(),
        clients: clients.size,
        timestamp: Date.now(),
      }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // WebSocket server on the same port (upgrade handler)
  wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info(`Gateway: client connected (${clients.size} total)`);

    ws.send(JSON.stringify({ type: "connected", agentId: config.employeeId }));

    // Re-broadcast any pending command approvals to new clients
    import("./security/command-approval.js").then(({ getPendingApprovals }) => {
      for (const p of getPendingApprovals()) {
        ws.send(JSON.stringify({
          type: "command_approval",
          approvalId: p.id,
          command: p.command,
          category: p.category,
          level: "HIGH",
          explanation: `Dangerous command detected: ${p.category}`,
        }));
      }
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "command_approval_response") {
          const { resolveCommandApproval } = await import("./security/command-approval.js");
          const { recordApproval } = await import("./security/approval-interceptor.js");
          const resolved = resolveCommandApproval(msg.approvalId, msg.level);
          if (resolved && msg.level !== "deny") {
            await recordApproval(msg.command || "", msg.level, null as any);
          }
          logger.info(`Gateway: command approval ${msg.approvalId} → ${msg.level}`);
        }
      } catch (err) {
        logger.warn("Gateway: invalid WebSocket message", { error: (err as Error).message });
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info(`Gateway: client disconnected (${clients.size} total)`);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  server.listen(PORT, () => {
    logger.info(`Gateway on port ${PORT} (ws + http)`);
    logger.info(`  POST /sync   — trigger config reload`);
    logger.info(`  GET  /health — engine health check`);
  });

  subscribeApprovalChannel();
  subscribeSyncChannel();
}

// Rails EngineSync publishes config_reload events here when the agent
// row, skills, or channel configs change. Fires the same handler as the
// HTTP POST /sync endpoint — Rails can't reach the engine over HTTP
// (Fly 6pn private network) but both sides speak to the same Valkey.
function subscribeSyncChannel(): void {
  const agentId = process.env.EMPLOYEE_ID;
  if (!agentId) return;
  const channel = `agent-${agentId}-sync`;
  const sub = redis.duplicate();
  sub.subscribe(channel, (err) => {
    if (err) {
      logger.warn("Sync sub: failed to subscribe", { error: err.message });
      return;
    }
    logger.info(`Sync sub: listening on ${channel}`);
  });
  sub.on("message", async () => {
    try {
      if (!onSyncRequested) return;
      await onSyncRequested();
      logger.info("Sync sub: config reloaded");
    } catch (err) {
      logger.warn("Sync sub: handler failed", { error: (err as Error).message });
    }
  });
}

// In production the browser can't open a direct WS into the engine (Fly
// 6pn private network), so command-approval RESPONSES from the user come
// in via Rails → Redis pub/sub instead. Subscribe here so the existing
// resolveCommandApproval + recordApproval flow fires the same way it does
// for a local-dev WS message.
function subscribeApprovalChannel(): void {
  const agentId = process.env.EMPLOYEE_ID;
  if (!agentId) return;
  const channel = `agent-${agentId}-approvals`;
  const sub = redis.duplicate();
  sub.subscribe(channel, (err) => {
    if (err) {
      logger.warn("Approval sub: failed to subscribe", { error: err.message });
      return;
    }
    logger.info(`Approval sub: listening on ${channel}`);
  });
  sub.on("message", async (_ch, raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type !== "command_approval_response") return;
      const { resolveCommandApproval } = await import("./security/command-approval.js");
      const { recordApproval } = await import("./security/approval-interceptor.js");
      const resolved = resolveCommandApproval(msg.approvalId, msg.level);
      if (resolved && msg.level !== "deny") {
        await recordApproval(msg.command || "", msg.level, null as any);
      }
      logger.info(`Approval sub: ${msg.approvalId} → ${msg.level}`);
    } catch (err) {
      logger.warn("Approval sub: bad payload", { error: (err as Error).message });
    }
  });
}

// Broadcast event to all connected clients AND relay to Rails so the
// web UI can render it over ActionCable (the engine WS isn't reachable
// from browsers in prod — Fly 6pn is private). The Rails side broadcasts
// to AgentChatChannel which the browser subscribes to.
export function broadcast(event: Record<string, unknown>): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
  relayToRails(event).catch(() => {}); // fire-and-forget, don't block
}

let lastRelayFailureAt = 0;
async function relayToRails(event: Record<string, unknown>): Promise<void> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  const agentId = process.env.EMPLOYEE_ID;
  if (!rails || !secret || !agentId) return;
  try {
    await fetch(`${rails}/api/agent_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Engine-Secret": secret,
      },
      body: JSON.stringify({ agent_id: Number(agentId), event }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (err) {
    // Rate-limit the warn so a temporary Rails outage doesn't spam logs
    const now = Date.now();
    if (now - lastRelayFailureAt > 30_000) {
      lastRelayFailureAt = now;
      logger.warn("Rails relay failed (suppressing for 30s)", { error: (err as Error).message });
    }
  }
}

// Event helpers
export function emitThinking(): void {
  broadcast({ type: "thinking", timestamp: Date.now() });
}

export function emitTextDelta(jobId: string | undefined, text: string): void {
  broadcast({ type: "text_delta", text, jobId, timestamp: Date.now() });
  // Route to the one listener keyed to this job. Broadcasting to every
  // active listener was leaking streaming content across channels when
  // jobs queued (e.g. a scheduled task's tool output showing up in a
  // waiting Telegram thread).
  if (!jobId) return;
  const listener = textDeltaListeners.get(jobId);
  if (listener) {
    try { listener(text); } catch {}
  }
}

// Human-readable labels for tool calls. Used by Telegram status messages,
// web UI progress indicators, and the progress broadcast event.
const TOOL_LABELS: Record<string, string> = {
  WebSearch: "🔍 Searching the web...",
  WebFetch: "🌐 Fetching page...",
  Read: "📄 Reading file...",
  Write: "✏️ Writing file...",
  Bash: "⚙️ Running command...",
  Browser: "🖥️ Using browser...",
  Skill: "📚 Loading skill...",
  Agent: "🤖 Delegating to sub-agent...",
  Grep: "🔎 Searching code...",
  Glob: "📂 Finding files...",
};

// Composio + MCP tools: extract a readable name from prefixed tool names
function humanizeToolName(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];

  // mcp__composio__GOOGLESHEETS_CREATE_GOOGLE_SHEET1 → "Creating Google Sheet..."
  // mcp__composio__VERCEL_CREATE_DEPLOYMENT → "Deploying to Vercel..."
  // mcp__tasks__write_checkpoint → "Saving progress..."
  // mcp__recall__search_messages → "Searching messages..."
  const composioMatch = tool.match(/^mcp__composio__(\w+?)_(.+)/);
  if (composioMatch && composioMatch[1] && composioMatch[2]) {
    const app = composioMatch[1].toLowerCase().replace(/s$/, "");
    const action = composioMatch[2].toLowerCase().replace(/_/g, " ").replace(/\d+$/, "").trim();
    return `🔗 ${capitalize(app)}: ${action}...`;
  }

  const mcpMatch = tool.match(/^mcp__(.+?)__(.+)/);
  if (mcpMatch && mcpMatch[1] && mcpMatch[2]) {
    const server = mcpMatch[1].replace(/-/g, " ");
    const action = mcpMatch[2].replace(/_/g, " ");
    return `🔧 ${capitalize(server)}: ${action}...`;
  }

  return `🔧 ${tool}...`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getToolLabel(tool: string): string {
  return humanizeToolName(tool);
}

export function emitToolCall(jobId: string | undefined, tool: string, input: unknown): void {
  const label = humanizeToolName(tool);
  logger.info(`Tool: ${tool} → ${label}`);
  broadcast({ type: "tool_call", tool, label, input, jobId, timestamp: Date.now() });
  broadcast({ type: "progress", label, tool, jobId, timestamp: Date.now() });
  // Route to the one listener keyed to this job. Broadcasting to all
  // listeners was leaking one job's tool labels into another job's open
  // channel thread.
  if (!jobId) return;
  const listener = toolCallListeners.get(jobId);
  if (listener) {
    try { listener(tool); } catch {}
  }
}

export function emitToolResult(tool: string, result: string): void {
  broadcast({ type: "tool_result", tool, result: result.slice(0, 500), timestamp: Date.now() });
}

// Listeners for agent events (channels like Telegram subscribe to these).
// Keyed by jobId (correlation ID) so a given job's response goes to exactly
// the right channel handler — no FIFO hijacking, no stale-listener bugs.
const doneListeners = new Map<string, (content: string) => void>();
const toolCallListeners = new Map<string, (tool: string) => void>();
const textDeltaListeners = new Map<string, (text: string) => void>();

export function onDone(jobId: string, listener: (content: string) => void): () => void {
  if (doneListeners.has(jobId)) {
    logger.warn(`Gateway onDone: duplicate registration for jobId=${jobId}, overwriting`);
  }
  doneListeners.set(jobId, listener);
  return () => { doneListeners.delete(jobId); };
}

export function onToolCall(jobId: string, listener: (tool: string) => void): () => void {
  toolCallListeners.set(jobId, listener);
  return () => { toolCallListeners.delete(jobId); };
}

// Subscribe to text deltas as the agent produces response text. Fires
// multiple times per run. Channels use this to stream (edit messages
// progressively) instead of waiting for the final emitDone.
export function onTextDelta(jobId: string, listener: (text: string) => void): () => void {
  textDeltaListeners.set(jobId, listener);
  return () => { textDeltaListeners.delete(jobId); };
}

export function emitDone(jobId: string, content: string): void {
  broadcast({ type: "done", jobId, content, timestamp: Date.now() });
  const listener = doneListeners.get(jobId);
  if (listener) {
    // One-shot: remove first so a throw doesn't leave it registered
    doneListeners.delete(jobId);
    try {
      listener(content);
      logger.info(`Gateway emitDone: dispatched to jobId=${jobId} (${doneListeners.size} other listeners remain)`);
    } catch (err) {
      logger.error(`Gateway emitDone: listener threw`, { error: (err as Error).message });
    }
  } else {
    logger.warn(`Gateway emitDone: no listener for jobId=${jobId} — message dropped (${doneListeners.size} listeners registered for other jobs)`);
  }
}

export function emitApproval(approvalId: number, toolName: string, toolInput: Record<string, unknown>): void {
  broadcast({ type: "pending_approval", approvalId, toolName, toolInput, timestamp: Date.now() });
}

export function emitError(error: string): void {
  broadcast({ type: "error", error, timestamp: Date.now() });
}

export function emitCommandApproval(data: {
  approvalId: string;
  command: string;
  category: string;
  level: string;
  explanation: string;
  suggestedFix?: string;
}): void {
  broadcast({ type: "command_approval", ...data, timestamp: Date.now() });
}

// Sprint 3 — media sent during the current agent run. Collected here so
// agent-runner can persist them on the assistant message after the run.
let pendingMedia: Array<{ url: string; filename: string; contentType: string; byteSize: number; signedId?: string }> = [];

export function emitMediaAttachment(media: {
  url: string;
  filename: string;
  contentType: string;
  byteSize: number;
  caption?: string;
  signedId?: string;
}): void {
  broadcast({ type: "media_attachment", ...media, timestamp: Date.now() });
  pendingMedia.push(media);
}

export function consumePendingMedia() {
  const result = [...pendingMedia];
  pendingMedia = [];
  return result;
}

// Helper for HTTP JSON bodies (RAG ingest/management endpoints)
async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}
