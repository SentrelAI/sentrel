import { config } from "../config.js";
import { redis } from "../queue.js";
import * as db from "../db.js";
import { onDone } from "../gateway.js";
import { logger } from "../logger.js";

let pollingActive = false;
let lastUpdateId = 0;

interface TelegramConfig {
  bot_token: string;
  bot_username: string;
  chat_id?: string;
}

export async function startTelegramPolling(): Promise<void> {
  // Get telegram channel config from DB
  const agent = await db.getAgent(config.employeeId);
  const channelConfigs = await db.getChannelConfigs(config.employeeId);
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
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const from = message.from;
  const fromName = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "Unknown";
  const username = from?.username || "";

  logger.info(`Telegram: message from ${fromName} (@${username}): ${message.text.slice(0, 50)}`);

  // Send "typing" indicator
  await sendTyping(botToken, chatId);

  // Start repeating typing every 4 seconds
  const typingInterval = setInterval(() => sendTyping(botToken, chatId), 4000);

  // Push to agent inbox
  await redis.lpush(`agent-inbox-${config.employeeId}`, JSON.stringify({
    type: "inbound_message",
    agentId: config.employeeId,
    orgId,
    channel: "telegram",
    payload: {
      from: username || String(from?.id),
      from_name: fromName,
      body: message.text,
      metadata: {
        chat_id: chatId,
        message_id: message.message_id,
        bot_token: botToken,
      },
    },
  }));

  // Wait for response from gateway WebSocket broadcast
  // The agent-runner will emit "done" event — we listen for it
  const response = await waitForResponse(120_000);

  // Stop typing
  clearInterval(typingInterval);

  // Send response to Telegram
  if (response) {
    await sendMessage(botToken, chatId, response);
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
  };
}
