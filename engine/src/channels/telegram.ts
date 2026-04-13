import { config } from "../config.js";
import { redis } from "../queue.js";
import { host } from "../host/index.js";
import { onDone } from "../gateway.js";
import { logger } from "../logger.js";

// Sprint 1a — Telegram media types we accept (best-largest size for photos,
// otherwise the file_id verbatim).
interface TelegramFileRef {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

let pollingActive = false;
let lastUpdateId = 0;

interface TelegramConfig {
  bot_token: string;
  bot_username: string;
  chat_id?: string;
}

export async function startTelegramPolling(): Promise<void> {
  // Get telegram channel config from DB
  const agent = await host.getAgent(config.employeeId);
  const channelConfigs = await host.getChannelConfigs(config.employeeId);
  const telegramConfig = channelConfigs.find((c) => c.channel_type === "telegram");

  if (!telegramConfig || !telegramConfig.config?.bot_token) {
    logger.info("Telegram: no bot token configured, skipping");
    return;
  }

  const botToken = telegramConfig.config.bot_token as string;
  pollingActive = true;

  logger.info(`Telegram: polling started for @${telegramConfig.config.bot_username || "bot"}`);

  poll(botToken, agent.organization_id);
}

async function poll(botToken: string, orgId: number): Promise<void> {
  let consecutiveErrors = 0;

  while (pollingActive) {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
      const res = await fetch(url);
      const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };

      // Reset error counter on success
      if (consecutiveErrors > 0) {
        logger.info(`Telegram: recovered after ${consecutiveErrors} errors`);
        consecutiveErrors = 0;
      }

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          await handleUpdate(update, botToken, orgId);
        }
      }
    } catch (err) {
      consecutiveErrors++;
      // Only log every 10th error to reduce spam during outages
      if (consecutiveErrors === 1 || consecutiveErrors % 10 === 0) {
        logger.warn(`Telegram poll error (${consecutiveErrors} consecutive)`, { error: (err as Error).message });
      }
      // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
      const backoff = Math.min(5000 * Math.pow(2, Math.min(consecutiveErrors - 1, 4)), 60000);
      await sleep(backoff);
      continue;
    }
  }
}

async function handleUpdate(update: TelegramUpdate, botToken: string, orgId: number): Promise<void> {
  const message = update.message;
  if (!message) return;

  // Sprint 1a — accept text OR any supported media type
  const hasText = !!message.text;
  const hasMedia = !!(message.photo || message.document || message.voice || message.audio || message.video);
  if (!hasText && !hasMedia) return;

  const chatId = message.chat.id;
  const from = message.from;
  const fromName = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "Unknown";
  const username = from?.username || "";

  // Log a useful summary
  const summary = message.text?.slice(0, 50)
    || (message.photo ? `[photo]` : "")
    || (message.document ? `[document: ${message.document.file_name || "file"}]` : "")
    || (message.voice ? `[voice ${message.voice.file_size || "?"}b]` : "")
    || (message.audio ? `[audio]` : "")
    || (message.video ? `[video]` : "");
  logger.info(`Telegram: message from ${fromName} (@${username}): ${summary}`);

  // Show "typing" while we download + process
  await sendTyping(botToken, chatId);
  const typingInterval = setInterval(() => sendTyping(botToken, chatId), 4000);

  // Download any media and upload to Rails ActiveStorage via host
  const attachmentSignedIds: string[] = [];
  try {
    if (message.photo && message.photo.length > 0) {
      // Photos arrive as a size ladder; pick the largest
      const largest = message.photo.reduce((a, b) => (a.file_size ?? 0) >= (b.file_size ?? 0) ? a : b);
      const id = await downloadAndUpload(botToken, largest, "photo.jpg", "image/jpeg");
      if (id) attachmentSignedIds.push(id);
    }
    if (message.document) {
      const id = await downloadAndUpload(
        botToken,
        message.document,
        message.document.file_name || `document-${message.document.file_unique_id || "file"}`,
        message.document.mime_type || "application/octet-stream",
      );
      if (id) attachmentSignedIds.push(id);
    }
    if (message.voice) {
      const id = await downloadAndUpload(
        botToken,
        message.voice,
        `voice-${message.voice.file_unique_id || message.message_id}.ogg`,
        message.voice.mime_type || "audio/ogg",
      );
      if (id) attachmentSignedIds.push(id);
    }
    if (message.audio) {
      const id = await downloadAndUpload(
        botToken,
        message.audio,
        message.audio.file_name || `audio-${message.audio.file_unique_id || message.message_id}.mp3`,
        message.audio.mime_type || "audio/mpeg",
      );
      if (id) attachmentSignedIds.push(id);
    }
    if (message.video) {
      const id = await downloadAndUpload(
        botToken,
        message.video,
        `video-${message.video.file_unique_id || message.message_id}.mp4`,
        message.video.mime_type || "video/mp4",
      );
      if (id) attachmentSignedIds.push(id);
    }
  } catch (err) {
    logger.error("Telegram: failed to download/upload media", { error: (err as Error).message });
  }

  // Body falls back to caption if there's no text but there is media
  const body = message.text || message.caption || "";

  // Push to agent inbox
  await redis.lpush(`agent-inbox-${config.employeeId}`, JSON.stringify({
    type: "inbound_message",
    agentId: config.employeeId,
    orgId,
    channel: "telegram",
    payload: {
      from: username || String(from?.id),
      from_name: fromName,
      body,
      attachment_ids: attachmentSignedIds,
      metadata: {
        chat_id: chatId,
        message_id: message.message_id,
        bot_token: botToken,
      },
    },
  }));

  // Wait for response from gateway WebSocket broadcast
  const response = await waitForResponse(120_000);

  clearInterval(typingInterval);

  if (response) {
    await sendMessage(botToken, chatId, response);
  }
}

// Calls Telegram getFile, downloads bytes from the CDN, uploads via host.
async function downloadAndUpload(
  botToken: string,
  file: TelegramFileRef,
  filename: string,
  contentType: string,
): Promise<string | null> {
  try {
    const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${file.file_id}`);
    const fileInfo = await fileInfoRes.json() as { ok: boolean; result?: { file_path: string } };
    if (!fileInfo.ok || !fileInfo.result?.file_path) {
      logger.warn(`Telegram getFile failed for ${file.file_id}`);
      return null;
    }

    const cdnUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
    const bytesRes = await fetch(cdnUrl);
    if (!bytesRes.ok) {
      logger.warn(`Telegram CDN fetch failed: ${bytesRes.status}`);
      return null;
    }
    const arrayBuffer = await bytesRes.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const result = await host.uploadBlob(bytes, filename, contentType);
    logger.info(`Telegram: uploaded ${filename} (${result.byte_size} bytes)`);
    return result.signed_id;
  } catch (err) {
    logger.error(`Telegram downloadAndUpload error for ${filename}`, { error: (err as Error).message });
    return null;
  }
}

async function sendTyping(botToken: string, chatId: number): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {}
}

async function sendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  try {
    // Telegram max message length is 4096
    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        }),
      });
    }
    logger.info(`Telegram: sent response (${text.length} chars)`);
  } catch (err) {
    // Retry without markdown if parsing fails
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (err2) {
      logger.error("Telegram send failed", { error: (err2 as Error).message });
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Split at last newline before limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function waitForResponse(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;

    const listener = (content: string) => {
      if (!resolved) {
        resolved = true;
        resolve(content);
      }
    };

    onDone(listener);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function stopTelegramPolling(): void {
  pollingActive = false;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    // Sprint 1a — media types
    photo?: TelegramFileRef[];          // size ladder; pick the largest
    document?: TelegramFileRef;
    voice?: TelegramFileRef;
    audio?: TelegramFileRef;
    video?: TelegramFileRef;
  };
}
