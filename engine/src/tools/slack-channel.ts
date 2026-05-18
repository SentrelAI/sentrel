// slack — outbound for the Slack-as-channel lane (the bot user installed in
// the user's workspace via /slack/install). Distinct from the Composio Slack
// integration tools, which call user-OAuth Slack endpoints for agent tool use.
//
// Rails is the only thing that holds the bot_token. We POST through
// /api/send_slack_message; the controller resolves the agent's ChannelConfig,
// honors send_slack_message=draft approval gates, and reports back with the
// posted message ts.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { railsInternalUrl } from "../host/rails-url.js";

interface SlackChannelContext {
  agentId: number;
}

async function postMessage(args: {
  agent_id: number;
  channel?: string;
  text: string;
  thread_ts?: string;
}): Promise<unknown> {
  const url = `${railsInternalUrl()}/api/send_slack_message`;
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) throw new Error("slack.post: ENGINE_API_SECRET not set");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Engine-Secret": secret,
    },
    body: JSON.stringify(args),
  });

  if (res.status === 202) {
    // Approval pending — surface upstream so the agent waits.
    const body = (await res.json()) as { approval_id?: number };
    return { ok: false, pending: true, approval_id: body.approval_id };
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`slack.post failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export function createSlackChannelMcpServer(ctx: SlackChannelContext) {
  return createSdkMcpServer({
    name: "slack-channel",
    version: "1.0.0",
    tools: [
      tool(
        "slack.post",
        "Send a Slack message in your own dedicated channel (auto-routed). Pass an explicit `channel` only when replying to a message in a different channel — e.g. a thread in #general where you were @mentioned. Use `thread_ts` to reply in-thread to the parent message.",
        {
          text: z.string().describe("Message body. Markdown subset supported by Slack (`*bold*`, `_italic_`, `\\`code\\``, lists)."),
          channel: z
            .string()
            .optional()
            .describe("Slack channel id (C…) or DM channel id (D…). Default: your own bound channel. Override only when replying outside your home channel — use the `channel` from incoming message metadata."),
          thread_ts: z
            .string()
            .optional()
            .describe("Parent message's ts to keep the reply in-thread. Default: top-level post."),
        },
        async (args) => {
          try {
            const result = await postMessage({
              agent_id: ctx.agentId,
              channel: args.channel,
              text: args.text,
              thread_ts: args.thread_ts,
            });
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          } catch (err) {
            logger.error("slack.post failed", err);
            return {
              content: [
                {
                  type: "text",
                  text: `slack.post error: ${(err as Error).message}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
