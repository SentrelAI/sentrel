import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { logger } from "./logger.js";

const PORT = parseInt(process.env.GATEWAY_PORT || "3300");

// Connected clients
const clients = new Set<WebSocket>();

let wss: WebSocketServer;

export function startGateway(): void {
  wss = new WebSocketServer({ port: PORT });

  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.info(`Gateway: client connected (${clients.size} total)`);

    // Send current status
    ws.send(JSON.stringify({ type: "connected", agentId: config.employeeId }));

    ws.on("close", () => {
      clients.delete(ws);
      logger.info(`Gateway: client disconnected (${clients.size} total)`);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  logger.info(`Gateway WebSocket server on ws://localhost:${PORT}`);
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
}

export function emitToolResult(tool: string, result: string): void {
  broadcast({ type: "tool_result", tool, result: result.slice(0, 500), timestamp: Date.now() });
}

// Listeners for done events (channels like Telegram need to know when response is ready)
const doneListeners: ((content: string) => void)[] = [];
export function onDone(listener: (content: string) => void): void {
  doneListeners.push(listener);
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
