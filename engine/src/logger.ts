import winston from "winston";
import Transport from "winston-transport";

// A broadcaster hook is set by gateway.ts once it boots. Logs flow through
// broadcast() → /api/agent_events → AgentChatChannel → browser logs drawer
// in real time (replaces the 4s poll). The indirection avoids a circular
// import between logger.ts and gateway.ts.
type LogBroadcaster = (event: Record<string, unknown>) => void;
let logBroadcaster: LogBroadcaster | null = null;
export function setLogBroadcaster(fn: LogBroadcaster): void {
  logBroadcaster = fn;
}

class BroadcastTransport extends Transport {
  override log(info: any, callback: () => void): void {
    try {
      if (logBroadcaster) {
        logBroadcaster({
          type: "log",
          level: info[Symbol.for("level")] ?? info.level,
          message: String(info.message ?? ""),
          // Metadata is anything beyond the winston-reserved keys
          meta: Object.fromEntries(
            Object.entries(info).filter(([k]) => !["level", "message", "timestamp"].includes(k) && typeof k === "string"),
          ),
          timestamp: Date.now(),
        });
      }
    } catch {
      // Never let a broadcast failure crash a log call
    }
    callback();
  }
}

const transports: winston.transport[] = [
  new winston.transports.Console(),
  new BroadcastTransport({ level: "info" }),
];

// Better Stack via @logtail/winston (opt-in via BETTERSTACK_SOURCE_TOKEN)
const bsToken = process.env.BETTERSTACK_SOURCE_TOKEN;
let logtail: any = null;

if (bsToken) {
  const { Logtail } = await import("@logtail/node");
  const { LogtailTransport } = await import("@logtail/winston");
  logtail = new Logtail(bsToken);
  transports.push(new LogtailTransport(logtail));
}

// Dev: human-readable. Production with Better Stack: still human-readable
// locally, logtail transport handles structured shipping.
const format = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format,
  transports,
});

export async function flushLogs() {
  if (logtail) await logtail.flush();
}
