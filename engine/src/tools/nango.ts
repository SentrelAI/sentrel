// nango_request — the agent's generic gateway to any Nango-connected app
// (GitHub, Linear, Gmail, Slack, Airtable, …). One tool, every provider: the
// agent names the provider + an HTTP method/path, and Rails (Api::Integrations
// #proxy → Nango::Proxy) injects the fresh access token (managed/byo_oauth via
// Nango's /proxy, or the pasted key for byo_token) and forwards the call.
//
// The token NEVER reaches the engine — calls round-trip through Rails, which
// also enforces the per-agent AgentToolPolicy (read/write) + the approval gate
// for writes to gated providers. The agent learns each app's endpoints from its
// installed SKILL.md (auto-installed on connect), so there's no per-endpoint
// tool surface to maintain — unlike Composio.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { railsInternalUrl } from "../host/rails-url.js";
import { postProposal } from "./connections.js";
import { createActionApproval } from "../security/action-approval.js";
import { emitActionApproval } from "../gateway.js";
import { host } from "../host/index.js";
import type { Origin } from "../channels/origin-delivery.js";

interface NangoContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

interface ProxyResult {
  status: number;
  body: unknown;
  source?: string;
}

function titleCase(s: string): string {
  return s.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function buildNangoMcpServer(ctx: NangoContext) {
  const { agentId, orgId, origin } = ctx;

  const requestTool = tool(
    "request",
    "Call a connected app's REST API (GitHub, Linear, Gmail, Slack, Airtable, Notion, Sentry, …). " +
      "Pass `provider` (the app slug, e.g. 'github'), `method` (GET/POST/PUT/PATCH/DELETE), and `path` (the API path relative to the app's base URL, e.g. '/user' or '/repos/acme/web/issues'). " +
      "Add `query` and `body` as needed. The connected account's auth is injected server-side — never include tokens yourself. " +
      "Consult the app's installed skill for its endpoints. If you get `not connected`, a Connect card is posted for the user; don't retry until they connect. " +
      "Writes to gated providers (Meta, LinkedIn, TikTok) pause for human approval.",
    {
      provider: z.string().describe("App slug, e.g. 'github', 'linear', 'gmail', 'slack'. Must be a connected app."),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method. GET/HEAD are reads; the rest are writes (may require approval)."),
      path: z.string().describe("API path relative to the app's base URL, e.g. '/user' or '/v1/invoices'. Include a leading slash."),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query-string params as a flat object."),
      body: z.any().optional().describe("Request body (JSON). Omit for GET."),
      purpose: z.string().optional().describe("One short sentence on what this call does — shown on the approval card for gated writes."),
    },
    async (args) => {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret) {
        return { content: [{ type: "text" as const, text: "nango_request: ENGINE_API_SECRET not set on the engine." }], isError: true };
      }

      const call = (approved: boolean) =>
        fetch(`${railsInternalUrl()}/api/nango_proxy`, {
          method: "POST",
          headers: { "X-Engine-Secret": secret, "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            provider: args.provider,
            method: args.method,
            path: args.path,
            query: args.query ?? {},
            body: args.body ?? null,
            approved,
          }),
        });

      try {
        let res = await call(false);

        // Not connected → post a Connect card and stop (don't retry).
        if (res.status === 404) {
          const data = await res.json().catch(() => ({}));
          if ((data as { needs_connection?: boolean }).needs_connection) {
            await postProposal({
              ctx: { agentId, orgId, origin },
              slug: args.provider.toLowerCase(),
              label: titleCase(args.provider),
              why: args.purpose || `to use ${titleCase(args.provider)}`,
              kind: "api_credential",
            });
            return {
              content: [{ type: "text" as const, text: `${titleCase(args.provider)} isn't connected yet — posted a Connect card. Ask the user to connect it, then re-send. Don't retry until they confirm.` }],
              isError: true,
            };
          }
        }

        // Per-agent policy forbids this verb.
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          return {
            content: [{ type: "text" as const, text: `Not allowed: ${(data as { error?: string }).error || "this agent's policy forbids that operation on " + args.provider}.` }],
            isError: true,
          };
        }

        // Gated write → pause for human approval, then re-call as approved.
        if (res.status === 202) {
          const decision = await gateWithApproval({ ctx: { agentId, orgId, origin }, provider: args.provider, method: args.method, path: args.path, purpose: args.purpose });
          if (decision === "rejected") {
            return { content: [{ type: "text" as const, text: `Denied by user — they declined the ${args.method} ${args.provider} call. Don't retry.` }], isError: true };
          }
          res = await call(true);
        }

        if (!res.ok) {
          const text = await res.text();
          return { content: [{ type: "text" as const, text: `nango_request failed: ${res.status} ${text.slice(0, 300)}` }], isError: true };
        }

        const result = (await res.json()) as ProxyResult;
        const bodyText = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
        return {
          content: [{ type: "text" as const, text: `${args.provider} ${args.method} ${args.path} → ${result.status}\n${bodyText.slice(0, 8000)}` }],
          // A non-2xx upstream status is informational, not a tool error — let
          // the model read the body and decide what to do.
          isError: false,
        };
      } catch (err) {
        logger.error("nango_request fetch failed", { error: (err as Error).message });
        return { content: [{ type: "text" as const, text: `nango_request network error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({ name: "nango", version: "1.0.0", tools: [requestTool] });
}

// Surface a request_approval card for a gated write and await the decision.
// Mirrors secrets.ts gateWithApproval — same pending_approvals table + event.
async function gateWithApproval(opts: {
  ctx: NangoContext;
  provider: string;
  method: string;
  path: string;
  purpose?: string;
}): Promise<"approved" | "rejected"> {
  const { ctx, provider, method, path, purpose } = opts;
  const summary = `Let the agent ${method} ${titleCase(provider)} (${path})${purpose ? ` — ${purpose}` : ""}`;
  const payload: Record<string, unknown> = {
    provider, method, path, purpose: purpose ?? null,
    _preview_markdown:
      `**Agent wants to call ${titleCase(provider)}:** \`${method} ${path}\`\n\n` +
      (purpose ? `Why: ${purpose}\n\n` : "") +
      `This writes to ${titleCase(provider)} on your connected account. Approve to let it proceed, or deny to handle it yourself.`,
  };
  const { id: localId, promise } = createActionApproval(summary, "destructive_action");

  try {
    await host.createPendingActionApproval({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      summary,
      payloadType: "destructive_action",
      payload,
      options: [{ label: "Allow", value: "approve" }, { label: "Deny", value: "reject" }],
      riskTier: "high",
      approvalToken: localId,
      allowAmendment: false,
      origin: ctx.origin,
    });
  } catch (err) {
    logger.warn("nango_request: failed to persist approval row", { error: (err as Error).message });
  }

  emitActionApproval({
    approvalToken: localId,
    summary,
    payloadType: "destructive_action",
    payload,
    options: [{ label: "Allow", value: "approve" }, { label: "Deny", value: "reject" }],
    riskTier: "high",
    allowAmendment: false,
  });

  const decision = await promise;
  return decision.value === "approve" ? "approved" : "rejected";
}
