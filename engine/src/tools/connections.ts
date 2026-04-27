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
import { host } from "../host/index.js";
import { emitConnectionProposal } from "../gateway.js";
import type { Origin } from "../channels/origin-delivery.js";

// Mirror of AVAILABLE_INTEGRATIONS in app/frontend/pages/integrations/index.tsx.
// Only services in this list have Connect buttons on the integrations page;
// propose_connection is restricted to them so the agent doesn't surface a
// dead button for services we don't support yet.
//
// To add a new service: add it here AND to the AVAILABLE_INTEGRATIONS array
// AND set up the Composio auth_config at composio.dev → Auth configs.
export const SUPPORTED_INTEGRATIONS: Record<string, string> = {
  apollo:           "Apollo",
  hubspot:          "HubSpot",
  linkedin:         "LinkedIn",
  gmail:            "Gmail",
  slack:            "Slack",
  intercom:         "Intercom",
  googlecalendar:   "Google Calendar",
  googlesheets:     "Google Sheets",
  googledrive:      "Google Drive",
  notion:           "Notion",
  airtable:         "Airtable",
  calendly:         "Calendly",
  github:           "GitHub",
  linear:           "Linear",
  vercel:           "Vercel",
  stripe:           "Stripe",
  twitter:          "Twitter / X",
  figma:            "Figma",
  mailchimp:        "Mailchimp",
  typeform:         "Typeform",
  digital_ocean:    "DigitalOcean",
};

interface ConnectionsContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

export function buildConnectionsMcpServer(ctx: ConnectionsContext) {
  const supportedSlugs = Object.keys(SUPPORTED_INTEGRATIONS);

  const proposeConnectionTool = tool(
    "propose_connection",
    `Surface an inline 'Connect <service>' button to the user when they ask for something that requires a service the org hasn't connected yet. The button opens the OAuth flow in a popup. Use this INSTEAD of just telling them to go to /integrations themselves — they get a one-tap card right in the chat. After they connect, they'll re-prompt you.\n\nSUPPORTED service slugs (these are the ONLY values you may pass): ${supportedSlugs.join(", ")}. If the user asks for a service NOT in this list (e.g. Salesforce, Pipedrive, Zoho, Outlook), do NOT call this tool — instead tell them honestly we don't support that integration yet and ask if there's a supported alternative.`,
    {
      service: z.string().describe(
        `Toolkit slug. MUST be one of: ${supportedSlugs.join(", ")}. Lowercase, match exactly.`,
      ),
      label: z.string().optional().describe("Display name for the button — defaults to the official label for the slug. Override only if needed."),
      why: z.string().describe("One-line user-facing reason: 'to publish your post', 'to mark the deal Closed Lost', 'to send the campaign'. Shows on the connect card."),
    },
    async (args) => {
      const slug = args.service.toLowerCase();
      const officialLabel = SUPPORTED_INTEGRATIONS[slug];
      if (!officialLabel) {
        const list = supportedSlugs.join(", ");
        logger.warn(`Connection proposal rejected: unsupported service '${args.service}'`);
        return {
          content: [{
            type: "text",
            text: `'${args.service}' is not in our supported integrations list. Supported: ${list}. Tell the user we don't support that service yet — don't surface a connect card for it.`,
          }],
          isError: true,
        };
      }
      const label = args.label || officialLabel;

      // Persist the proposal so the inline card survives a page refresh.
      // Same table as action approvals — payload_type='connection_proposal'
      // makes it distinguishable on the frontend hydration path.
      const approvalToken = `conn_${Date.now()}_${slug}`;
      try {
        await host.createPendingActionApproval({
          orgId: ctx.orgId,
          agentId: ctx.agentId,
          summary: `Connect ${label} — ${args.why}`,
          payloadType: "connection_proposal",
          payload: { service: slug, label, why: args.why },
          options: [
            { label: `Connect ${label}`, value: "connect" },
            { label: "Not now", value: "dismiss" },
          ],
          riskTier: "low",
          approvalToken,
          allowAmendment: false,
          origin: ctx.origin,
        });
      } catch (err) {
        logger.warn("Failed to persist connection proposal", { error: (err as Error).message });
      }

      emitConnectionProposal({ service: slug, label, why: args.why });
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
