// Auto-delivery to the original user channel that started a delegation chain.
// Used by:
//   - agent-runner: when a "task-reportback-*" run completes and no native
//     channel listener exists for the synthetic jobId.
//   - progress_update tool: live status pings from a downstream worker mid-task.
//
// Origin is captured at the first inbound (channel poller / Rails enqueue) and
// propagated verbatim through every cross-agent delegation + report-back.

import { logger } from "../logger.js";
import { host } from "../host/index.js";
import type { JobData } from "../types.js";

export type Origin = NonNullable<JobData["origin"]>;

export async function deliverToOrigin(origin: Origin, content: string): Promise<void> {
  const meta = origin.metadata || {};
  const channel = origin.channel;

  if (channel === "telegram") {
    const botToken = meta.bot_token as string | undefined;
    const chatId = meta.chat_id as string | number | undefined;
    if (!botToken || !chatId) {
      logger.warn("Origin delivery: telegram missing bot_token or chat_id");
      return;
    }
    const { sendMessage } = await import("./telegram.js");
    await sendMessage(botToken, Number(chatId), content);
    logger.info(`Origin delivery: sent to Telegram chat ${chatId} (${content.length} chars)`);
    return;
  }

  if (channel === "whatsapp") {
    const from = meta.from as string | undefined;
    if (!from) {
      logger.warn("Origin delivery: whatsapp missing `from`");
      return;
    }
    const { sendMessage } = await import("./whatsapp.js");
    await sendMessage(from, content);
    logger.info(`Origin delivery: sent to WhatsApp ${from} (${content.length} chars)`);
    return;
  }

  if (channel === "web") {
    const convId = origin.conversationId;
    if (!convId) {
      logger.warn("Origin delivery: web channel missing conversationId");
      return;
    }
    const msg = await host.saveMessage(
      convId,
      "assistant",
      content,
      "outbound",
      "web",
      [],
      { source: "origin_delivery" },
    );
    logger.info(`Origin delivery: saved as message ${msg.id} on web conversation ${convId}`);
    return;
  }

  logger.warn(`Origin delivery: unsupported channel "${channel}" — message dropped`);
}
