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

export function emitToolCall(tool: string, input: unknown): void {
  broadcast({ type: "tool_call", tool, input, timestamp: Date.now() });
  for (const listener of toolCallListeners) {
    try { listener(tool); } catch {}
  }
}

export function emitToolResult(tool: string, result: string): void {
  broadcast({ type: "tool_result", tool, result: result.slice(0, 500), timestamp: Date.now() });
}

// Listeners for agent events (channels like Telegram subscribe to these)
const doneListeners: ((content: string) => void)[] = [];
const toolCallListeners: ((tool: string) => void)[] = [];

export function onDone(listener: (content: string) => void): void {
  doneListeners.push(listener);
}

export function onToolCall(listener: (tool: string) => void): void {
  toolCallListeners.push(listener);
}

export function emitDone(content: string): void {
  broadcast({ type: "done", content, timestamp: Date.now() });
  // Notify channel listeners
  for (const listener of doneListeners) {
    try { listener(content); } catch {}
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
