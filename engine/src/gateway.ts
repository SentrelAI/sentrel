import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { logger } from "./logger.js";

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
}

// Broadcast event to all connected clients
export function broadcast(event: Record<string, unknown>): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// Event helpers
export function emitThinking(): void {
  broadcast({ type: "thinking", timestamp: Date.now() });
}

export function emitTextDelta(text: string): void {
  broadcast({ type: "text_delta", text, timestamp: Date.now() });
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

export function emitToolCall(tool: string, input: unknown): void {
  const label = humanizeToolName(tool);
  broadcast({ type: "tool_call", tool, label, input, timestamp: Date.now() });
  // Also broadcast a progress event that any UI/channel can consume
  broadcast({ type: "progress", label, tool, timestamp: Date.now() });
  // Notify all active per-job listeners. Inbox processes serially so there is
  // typically one, but iterating is safe either way.
  for (const listener of toolCallListeners.values()) {
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
