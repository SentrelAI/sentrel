// Auth-on-demand: propose_connection MCP tool.
//
// When the agent realizes the user wants to do something that requires a
// service the org hasn't connected yet (LinkedIn, HubSpot, Salesforce,
// Notion, etc.), it calls this tool with the toolkit slug + a one-line why.
// The chat surface renders an inline card with a Connect button that opens
// the existing /integrations/:slug/connect OAuth flow in a popup.
//
// Agent doesn't pause — it returns a normal text reply explaining what'll
// happen once the user connects. After the OAuth completes, the user
// re-prompts and the agent has the toolkit available.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { emitConnectionProposal } from "../gateway.js";

export function buildConnectionsMcpServer() {
  const proposeConnectionTool = tool(
    "propose_connection",
    "Surface an inline 'Connect <service>' button to the user when they ask for something that requires a service the org hasn't connected yet. The button opens the OAuth flow in a popup. Use this INSTEAD of just telling them to go to /integrations themselves — they get a one-tap card right in the chat. After they connect, they'll re-prompt you.",
    {
      service: z.string().describe(
        "Toolkit slug as Composio knows it: 'linkedin', 'hubspot', 'salesforce', 'notion', 'slack', 'github', 'twitter', 'gmail', 'mailchimp', etc. Lowercase. Match what's listed on /integrations.",
      ),
      label: z.string().optional().describe("Display name for the button — defaults to a Title Case of `service` ('LinkedIn', 'HubSpot'). Override only if the slug differs from the brand name."),
      why: z.string().describe("One-line user-facing reason: 'to publish your post', 'to mark the deal Closed Lost', 'to send the campaign'. Shows on the connect card."),
    },
    async (args) => {
      const label = args.label || titleCase(args.service);
      emitConnectionProposal({
        service: args.service,
        label,
        why: args.why,
      });
      logger.info(`Connection proposal: ${label} (${args.why})`);
      return {
        content: [{
          type: "text",
          text: `Posted a 'Connect ${label}' card. The user will see a button to authenticate; once they click + connect, they can re-send their request and you'll have ${label} tools available.`,
        }],
      };
    },
  );

  return createSdkMcpServer({
    name: "connections",
    version: "0.1.0",
    tools: [proposeConnectionTool],
  });
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
