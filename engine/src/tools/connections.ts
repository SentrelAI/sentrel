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
//
// propose_mcp_connection is the same card for a remote MCP server the user
// names by URL. The card connects it without leaving the chat (sign-in popup,
// pasted token, or nothing for a public server), and finishing resolves the
// proposal — which resumes this work in a fresh run with the server's tools.

import { randomUUID } from "crypto";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { host } from "../host/index.js";
import { emitConnectionProposal } from "../gateway.js";
import { getSupportedSlugs, getSupportedLabel } from "../integrations/supported.js";
import type { Origin } from "../channels/origin-delivery.js";

// The supported-integrations list is sourced dynamically from the integration
// broker's catalog (proxied through Rails) — see supported.ts. Add an
// integration server-side → it's usable here on next refresh (≤30 min). No
// code change required.

interface ConnectionsContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

export function buildConnectionsMcpServer(ctx: ConnectionsContext) {
  const proposeConnectionTool = tool(
    "propose_connection",
    "Surface an inline 'Connect <service>' or 'Add <provider> credential' card in the chat when the user wants something that requires external access the org hasn't set up yet. The user clicks once: for OAuth integrations (Apollo, HubSpot, Slack, Gmail, …) the OAuth popup opens; for API-token services (Intercom, Stripe, Heroku, any custom REST API) a credentials form opens in a new tab. ALWAYS prefer this card over telling the user to navigate to /integrations or /settings/credentials themselves.",
    {
      service: z.string().describe(
        "Service slug. For OAuth integrations: must be in the supported list (system prompt). For API-token credentials: any provider name the user would recognize ('intercom', 'stripe', 'heroku').",
      ),
      label: z.string().optional().describe("Display name. Defaults to the official label for supported slugs; for credentials defaults to title-cased service."),
      why: z.string().describe("One-line user-facing reason. Shows on the card."),
      kind: z.enum(["oauth", "api_credential"]).optional().describe(
        "Which kind of access to request. oauth (default) for OAuth-managed integrations in the supported catalog; api_credential for raw API tokens / keys the workspace owner pastes at /settings/credentials.",
      ),
    },
    async (args) => {
      const slug = args.service.toLowerCase();
      const officialLabel = getSupportedLabel(slug);
      // If the catalog knows how to connect this service, always propose the
      // connect flow — a service like Google Calendar authenticates by OAuth
      // and no pasted token can stand in for it, so a credential card sends
      // the user somewhere they can't finish. This matters because the
      // rejection text below tells the model to retry as api_credential, so a
      // momentarily-stale supported list is enough to strand a real
      // integration in the credential flow for good.
      const kind: "oauth" | "api_credential" = officialLabel ? "oauth" : (args.kind || "oauth");

      let label: string;
      if (kind === "oauth") {
        if (!officialLabel) {
          const list = getSupportedSlugs().join(", ");
          logger.warn(`Connection proposal rejected: unsupported OAuth service '${args.service}' (current: ${list})`);
          return {
            content: [{
              type: "text",
              text: `'${args.service}' isn't in our supported integrations. If this service has a public API token (like Intercom, Heroku, Stripe), retry with kind='api_credential' instead.`,
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

      const actionVerb = kind === "oauth" ? "authenticate via OAuth" : "paste their API token";
      return {
        content: [{
          type: "text",
          text: `Posted a 'Connect ${label}' card. The user will see a button to ${actionVerb}; once they're done they can re-send the request and you'll have ${label} access.`,
        }],
      };
    },
  );

  const proposeMcpConnectionTool = tool(
    "propose_mcp_connection",
    "Surface an inline 'Connect <name> MCP' card in the chat when the user asks you to connect, add or install a remote MCP server. The user finishes the whole connection inside the card — sign-in popup for OAuth servers, a token field for token-auth servers, one click for public ones — and you're resumed automatically with the server's tools once it's connected. ALWAYS prefer this over telling the user to edit config files or visit a settings page.",
    {
      url: z.string().describe("The server's remote MCP endpoint, e.g. https://mcp.linear.app/mcp. Must be a public https URL. Use the URL the user gave; if they only named the service and you aren't certain of its official MCP URL, ask them for it instead of guessing."),
      name: z.string().describe("Display name for the server, e.g. 'Linear'."),
      why: z.string().describe("One-line user-facing reason. Shows on the card."),
    },
    async (args) => {
      let url: URL;
      try {
        url = new URL(args.url.trim());
      } catch {
        return { content: [{ type: "text", text: `'${args.url}' isn't a valid URL. Ask the user for the server's MCP endpoint (it usually ends in /mcp or /sse).` }], isError: true };
      }
      if (url.protocol !== "https:") {
        return { content: [{ type: "text", text: `MCP servers must be reached over https — '${args.url}' isn't. Ask the user for the https endpoint.` }], isError: true };
      }

      const label = args.name.trim() || url.hostname;
      await postProposal({
        ctx,
        slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mcp",
        label,
        why: args.why,
        kind: "mcp",
        url: url.toString(),
      });

      return {
        content: [{
          type: "text",
          text: `Posted a 'Connect ${label} MCP' card. The user connects it right in the chat; when they finish you'll be resumed automatically with ${label}'s tools (named mcp__<server>__<tool>). Tell them briefly what you'll do once it's connected, then end your turn — don't wait or poll.`,
        }],
      };
    },
  );

  return createSdkMcpServer({
    name: "connections",
    version: "0.1.0",
    tools: [proposeConnectionTool, proposeMcpConnectionTool],
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
  kind: "oauth" | "api_credential" | "org_credential" | "mcp";
  url?: string; // mcp only: the server's endpoint
}): Promise<void> {
  const { ctx, slug, label, why, kind, url } = opts;
  // randomUUID (not Date.now) so two proposals for the same slug can't collide
  // on the pending_approvals.approval_token UNIQUE index.
  const prefix = kind === "oauth" ? "conn" : kind === "mcp" ? "mcp" : "cred";
  const approvalToken = `${prefix}_${slug}_${randomUUID()}`;
  const isConnect = kind === "oauth" || kind === "mcp";
  const target = kind === "mcp" ? `${label} MCP` : label;
  const summary = isConnect
    ? `Connect ${target} — ${why}`
    : `Add ${label} credential — ${why}`;
  const connectButtonLabel = isConnect ? `Connect ${target}` : `Add ${label} credential`;

  try {
    await host.createPendingActionApproval({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      summary,
      payloadType: "connection_proposal",
      payload: { service: slug, label, why, kind, ...(url ? { url } : {}) },
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

  emitConnectionProposal({ service: slug, label, why, kind, url, approvalToken });
  logger.info(`Proposal posted: ${kind} ${label} (${why})`);
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
