import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { railsPublicUrl } from "../host/rails-url.js";

// Sends a media file (audio, image, document) through the appropriate channel API.
// Called by the send_voice / send_image / send_file MCP tools.

export interface SendMediaOptions {
  channel: string;
  bytes: Buffer;
  filename: string;
  contentType: string;
  caption?: string;
  // Channel-specific routing info (from the current job's metadata)
  metadata: Record<string, unknown>;
}

export async function sendMedia(opts: SendMediaOptions): Promise<void> {
  switch (opts.channel) {
    case "telegram":
      return sendViaTelegram(opts);
    case "whatsapp":
      return sendViaWhatsApp(opts);
    case "email":
      logger.info("sendMedia: email attachments handled via outbox, skipping channel send");
      return;
    case "web":
      return sendViaWeb(opts);
    default:
      logger.warn(`sendMedia: unsupported channel ${opts.channel}`);
  }
}

// ── Telegram: multipart upload ──

async function sendViaTelegram(opts: SendMediaOptions): Promise<void> {
  const botToken = opts.metadata.bot_token as string;
  const chatId = opts.metadata.chat_id as number;
  if (!botToken || !chatId) {
    logger.error("sendMedia/telegram: missing bot_token or chat_id in metadata");
    return;
  }

  // Pick the right Telegram method based on content type
  let method: string;
  let fieldName: string;
  if (opts.contentType.startsWith("audio/")) {
    method = "sendVoice";
    fieldName = "voice";
  } else if (opts.contentType.startsWith("image/")) {
    method = "sendPhoto";
    fieldName = "photo";
  } else {
    method = "sendDocument";
    fieldName = "document";
  }

  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append(fieldName, new Blob([new Uint8Array(opts.bytes)], { type: opts.contentType }), opts.filename);
  if (opts.caption) {
    formData.append("caption", opts.caption);
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error(`Telegram ${method} failed: ${res.status} ${err}`);
  } else {
    logger.info(`Telegram: ${method} sent to chat ${chatId} (${opts.bytes.length}b)`);
  }
}

// ── Web: upload blob → emit via gateway so chat UI can render ──

async function sendViaWeb(opts: SendMediaOptions): Promise<void> {
  try {
    const blob = await host.uploadBlob(opts.bytes, opts.filename, opts.contentType);
    const url = `${railsPublicUrl()}/api/blobs/${blob.signed_id}`;

    // Import gateway to emit inline media to the chat UI
    const { emitMediaAttachment } = await import("../gateway.js");
    emitMediaAttachment({
      url,
      filename: opts.filename,
      contentType: opts.contentType,
      byteSize: opts.bytes.length,
      caption: opts.caption,
      signedId: blob.signed_id,
    });

    logger.info(`Web: sent media ${opts.filename} (${opts.bytes.length}b)`);
  } catch (err) {
    logger.error("Web media send failed", { error: (err as Error).message });
  }
}

// ── WhatsApp: upload to Rails blob → Twilio MediaUrl ──

async function sendViaWhatsApp(opts: SendMediaOptions): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const to = opts.metadata.from as string; // reply to sender
  const botNumber = opts.metadata.bot_number as string || process.env.WHATSAPP_BOT_NUMBER || "";

  if (!sid || !token || !to) {
    logger.error("sendMedia/whatsapp: missing Twilio creds or recipient");
    return;
  }

  // Upload blob to Rails so we get a public-ish URL
  const blob = await host.uploadBlob(opts.bytes, opts.filename, opts.contentType);

  // Build a URL Twilio can fetch. In dev with ngrok this works; in prod use S3 URLs.
  const mediaUrl = `${railsPublicUrl()}/rails/active_storage/blobs/${blob.signed_id}/${encodeURIComponent(opts.filename)}`;

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({
    From: `whatsapp:${botNumber}`,
    To: `whatsapp:${to}`,
    MediaUrl: mediaUrl,
  });
  if (opts.caption) body.append("Body", opts.caption);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    logger.error(`WhatsApp media send failed: ${res.status} ${await res.text()}`);
  } else {
    const data = await res.json() as { sid: string; status: string };
    logger.info(`WhatsApp: media ${data.sid} status=${data.status} to ${to}`);
  }
}
