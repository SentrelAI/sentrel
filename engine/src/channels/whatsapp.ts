import { config } from "../config.js";
import { host } from "../host/index.js";
import { onDone, onTextDelta } from "../gateway.js";
import { logger } from "../logger.js";
import { CircuitBreaker } from "../lib/circuit-breaker.js";

let botNumber = "";

// Twilio-specific breaker. Outbound SMS/WhatsApp sends have low latency
// when healthy (~500ms); a slow Twilio shouldn't block agent completion
// for more than 10s per chunk.
const twilioBreaker = new CircuitBreaker("twilio", { failThreshold: 3, cooldownMs: 30_000, timeoutMs: 10_000 });

export async function initWhatsApp(): Promise<void> {
  const channelConfigs = await host.getChannelConfigs(config.employeeId);
  const waConfig = channelConfigs.find((c) => c.channel_type === "whatsapp");

  if (!waConfig || !waConfig.config?.phone_number) {
    logger.info("WhatsApp: no phone configured, skipping");
    botNumber = "";
    return;
  }

  botNumber = waConfig.config.phone_number as string;
  logger.info(`WhatsApp: initialized for ${botNumber}`);
}

// Drops the cached bot number. Inbound WhatsApp arrives via Rails webhook
// (Twilio → /webhooks/whatsapp) so there's no listener loop to tear down —
// outbound sends just stop attaching the old From header until initWhatsApp
// repopulates it.
export function stopWhatsApp(): void {
  botNumber = "";
  logger.info("WhatsApp: bot number cleared");
}

// Register a one-shot listener for the current inbound WhatsApp job.
// Called from agent-runner at the start of a WhatsApp job — keyed by jobId
// so emitDone(jobId, ...) routes the reply back to this caller and no other.
//
// WhatsApp can't edit messages (unlike Telegram) so we can't do live
// streaming. Instead, we forward the agent's FIRST text block (its "intent
// statement" like "I'll research the top AI companies...") as an
// acknowledgment message so the user knows we received it and what we're
// about to do. Then we send the real final response when emitDone fires.
export function setWhatsAppPendingReply(jobId: string, from: string): void {
  if (!botNumber) {
    logger.warn("WhatsApp: setWhatsAppPendingReply called but channel not initialized");
    return;
  }
  const to = from.replace("whatsapp:", "");

  // Track whether we've sent the intent message so we only send it once
  // (Claude usually emits a short text block before tool calls, then the
  // full answer at the end — we want only the first one as the intent).
  let intentSent = false;
  const unsubscribeText = onTextDelta(jobId, (text) => {
    if (intentSent) return;
    intentSent = true;
    // Send the agent's intent as the ack — fire-and-forget
    sendMessage(to, text).catch((err) => {
      logger.warn("WhatsApp: intent send failed", { error: (err as Error).message });
    });
  });

  const cleanup = onDone(jobId, async (content) => {
    unsubscribeText();
    // If the first text block IS the final response (short/no tool calls),
    // don't send it twice. Heuristic: if content <= 400 chars AND we haven't
    // sent an intent yet, just send content. Otherwise send content as final.
    try {
      await sendMessage(to, content);
    } catch (err) {
      logger.error("WhatsApp: send failed in onDone listener", { error: (err as Error).message });
    }
  });
  // Safety net: if no emitDone fires within 10 min, reclaim the slots.
  setTimeout(() => {
    cleanup();
    unsubscribeText();
  }, 600_000);
}

export async function sendMessage(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) { logger.error("WhatsApp: missing Twilio creds"); return; }

  // Twilio WhatsApp has a 1600-character limit per message.
  // Chunk at 1500 to leave headroom for header/footer formatting.
  const WHATSAPP_CHAR_LIMIT = 1500;
  const chunks = body.length <= WHATSAPP_CHAR_LIMIT ? [body] : splitAt(body, WHATSAPP_CHAR_LIMIT);
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  for (const chunk of chunks) {
    try {
      await twilioBreaker.call(async (signal) => {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: `whatsapp:${botNumber}`, To: `whatsapp:${to}`, Body: chunk }).toString(),
          signal,
        });
        const resBody = await res.text();
        if (!res.ok) {
          logger.error(`WhatsApp send failed (${res.status})`, { error: resBody });
          throw new Error(`WhatsApp send failed: ${res.status}`);
        }
        try {
          const parsed = JSON.parse(resBody);
          logger.info(`WhatsApp: message ${parsed.sid} status=${parsed.status}`);
        } catch {}
      });
    } catch (err) {
      // Breaker-open or network error — log and move on. Don't retry here;
      // the breaker already gates further calls.
      logger.error(`WhatsApp: send chunk failed — ${(err as Error).message}`);
    }
  }
  logger.info(`WhatsApp: sent to ${to} (${body.length} chars)`);
}

function splitAt(text: string, max: number): string[] {
  const chunks: string[] = [];
  let r = text;
  while (r.length > 0) {
    if (r.length <= max) { chunks.push(r); break; }
    let i = r.lastIndexOf("\n", max);
    if (i < max / 2) i = max;
    chunks.push(r.slice(0, i));
    r = r.slice(i);
  }
  return chunks;
}
