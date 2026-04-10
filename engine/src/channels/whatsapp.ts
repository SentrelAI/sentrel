import { config } from "../config.js";
import { host } from "../host/index.js";
import { onDone } from "../gateway.js";
import { logger } from "../logger.js";

let pendingReply: { from: string } | null = null;
let botNumber = "";

export async function initWhatsApp(): Promise<void> {
  const channelConfigs = await host.getChannelConfigs(config.employeeId);
  const waConfig = channelConfigs.find((c) => c.channel_type === "whatsapp");

  if (!waConfig || !waConfig.config?.phone_number) {
    logger.info("WhatsApp: no phone configured, skipping");
    return;
  }

  botNumber = waConfig.config.phone_number as string;

  onDone(async (content) => {
    if (pendingReply) {
      await sendMessage(pendingReply.from, content);
      pendingReply = null;
    }
  });

  logger.info(`WhatsApp: initialized for ${botNumber}`);
}

export function setWhatsAppPendingReply(from: string): void {
  pendingReply = { from: from.replace("whatsapp:", "") };
}

async function sendMessage(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) { logger.error("WhatsApp: missing Twilio creds"); return; }

  const chunks = body.length <= 4096 ? [body] : splitAt(body, 4096);
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  for (const chunk of chunks) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: `whatsapp:${botNumber}`, To: `whatsapp:${to}`, Body: chunk }).toString(),
    });
    if (!res.ok) logger.error("WhatsApp send failed", { error: await res.text() });
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
