// Slack channel dispatcher — used by agent-runner after a run completes
// to auto-deliver the agent's final response to its Slack channel.
//
// Why auto-deliver instead of asking the agent to call slack.post:
//   Same pattern as telegram/whatsapp/email — the channel delivery is the
//   engine's job, not the agent's. The agent produces a final response;
//   the engine routes it to whichever channel inbound came in on. Without
//   this, the agent has no clue it needs to use slack.post and the run
//   completes silently (which is what shipped before).
//
// The slack.post MCP tool stays available for cases where the agent wants
// to send additional messages or cross-post (e.g. "log this to #ops").

import { logger } from "../logger.js";
import { railsInternalUrl } from "../host/rails-url.js";

interface SlackReplyArgs {
  agentId: number;
  // C… (public) or D… (DM) channel id. Omit / pass empty to fall through to
  // the agent's bound channel resolved Rails-side via ChannelConfig.
  channel: string;
  text: string;
  thread_ts?: string;     // keep reply in-thread
}

export async function deliverSlackReply(args: SlackReplyArgs): Promise<void> {
  if (!args.text?.trim()) return;

  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) {
    logger.warn("[slack] deliverSlackReply: ENGINE_API_SECRET not set — skipping");
    return;
  }

  const payload: Record<string, unknown> = {
    agent_id: args.agentId,
    text: args.text,
  };
  // Omit `channel` entirely when empty so Rails falls through to the agent's
  // bound channel (config.slack_channel_id). Don't send "" — that errors.
  if (args.channel) payload.channel = args.channel;
  if (args.thread_ts) payload.thread_ts = args.thread_ts;

  const res = await fetch(`${railsInternalUrl()}/api/send_slack_message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Engine-Secret": secret,
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 202) {
    // Approval pending — UX moves to /pending_approvals. Nothing posts to
    // Slack until the user approves; the engine treats it as success.
    logger.info(`[slack] reply queued for approval (agent=${args.agentId})`);
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    logger.warn(`[slack] reply failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
