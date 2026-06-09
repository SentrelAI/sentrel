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
import { getSupportedIntegrations, getSupportedSlugs, getSupportedLabel } from "../integrations/supported-cache.js";
import type { Origin } from "../channels/origin-delivery.js";

// The supported-integrations list is sourced dynamically from Composio's
// auth_configs (proxied through Rails) — see supported-cache.ts. Add an
// auth_config in the Composio dashboard → it's usable here on next refresh
// (≤30 min). No code change required.

interface ConnectionsContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

export function buildConnectionsMcpServer(ctx: ConnectionsContext) {
  const proposeConnectionTool = tool(
    "propose_connection",
    "Surface an inline 'Connect <service>' or 'Add <provider> credential' card in the chat when the user wants something that requires external access the org hasn't set up yet. The user clicks once: for Composio toolkits (Apollo, HubSpot, Slack, Gmail, …) the OAuth popup opens; for API-token services (Intercom, Stripe, Heroku, any custom REST API) a credentials form opens in a new tab. ALWAYS prefer this card over telling the user to navigate to /integrations or /settings/credentials themselves.",
    {
      service: z.string().describe(
        "Service slug. For Composio integrations: must be in the supported list (system prompt). For API-token credentials: any provider name the user would recognize ('intercom', 'stripe', 'heroku').",
      ),
      label: z.string().optional().describe("Display name. Defaults to the official label for Composio slugs; for credentials defaults to title-cased service."),
      why: z.string().describe("One-line user-facing reason. Shows on the card."),
      kind: z.enum(["composio_oauth", "api_credential"]).optional().describe(
        "Which kind of access to request. composio_oauth (default) for OAuth-managed integrations in the Composio catalog; api_credential for raw API tokens / keys the workspace owner pastes at /settings/credentials.",
      ),
    },
    async (args) => {
      const slug = args.service.toLowerCase();
      const kind = args.kind || "composio_oauth";

      let label: string;
      if (kind === "composio_oauth") {
        const officialLabel = getSupportedLabel(slug);
        if (!officialLabel) {
          const list = getSupportedSlugs().join(", ");
          logger.warn(`Connection proposal rejected: unsupported Composio service '${args.service}' (current: ${list})`);
          return {
            content: [{
              type: "text",
              text: `'${args.service}' isn't in our Composio toolkits. If this service has a public API token (like Intercom, Heroku, Stripe), retry with kind='api_credential' instead.`,
            }],
            isError: true,
          };
        }
        label = args.label || officialLabel;
      } else {
        // api_credential: free-form provider name. Title-case the slug if no
        // label was given. The credentials page accepts any provider string.
        label = args.label || titleCase(slug);
      }

      await postProposal({
        ctx,
        slug,
        label,
        why: args.why,
        kind,
      });

      const actionVerb = kind === "composio_oauth" ? "authenticate via OAuth" : "paste their API token";
      return {
        content: [{
          type: "text",
          text: `Posted a 'Connect ${label}' card. The user will see a button to ${actionVerb}; once they're done they can re-send the request and you'll have ${label} access.`,
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

// Shared helper — also used by tools/secrets.ts when secrets.get(404)s,
// so a missing credential auto-surfaces the same card the agent would
// have posted via propose_connection. Single source of truth for the
// "post an access-required card" path.
export async function postProposal(opts: {
  ctx: ConnectionsContext;
  slug: string;
  label: string;
  why: string;
  kind: "composio_oauth" | "api_credential" | "org_credential";
}): Promise<void> {
  const { ctx, slug, label, why, kind } = opts;
  const approvalToken = `${kind === "composio_oauth" ? "conn" : "cred"}_${Date.now()}_${slug}`;
  const summary = kind === "composio_oauth"
    ? `Connect ${label} — ${why}`
    : `Add ${label} credential — ${why}`;
  const connectButtonLabel = kind === "composio_oauth" ? `Connect ${label}` : `Add ${label} credential`;

  try {
    await host.createPendingActionApproval({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      summary,
      payloadType: "connection_proposal",
      payload: { service: slug, label, why, kind },
      options: [
        { label: connectButtonLabel, value: "connect" },
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

  emitConnectionProposal({ service: slug, label, why, kind });
  logger.info(`Proposal posted: ${kind} ${label} (${why})`);
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
