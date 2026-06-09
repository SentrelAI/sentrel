// secrets — agent reads stored credentials (cloud / generic API keys) for
// tools that don't have a dedicated Composio integration. Rails is the source
// of truth; this MCP server is a thin proxy that delegates ACL + audit logging
// to /api/secrets.
//
// Resolution order (Rails side):
//   1. by name              — direct lookup, must be in agent's grants
//   2. by (provider, kind)  — Credential.find_for resolves agent grant first
//                             then org default
//
// What this tool does NOT do:
//   - LLM provider keys are NOT exposed here; those are piped into the agent's
//     env at provision time so the SDK can authenticate the model call. Going
//     through the tool would leak the key into the conversation log.
//
// Approval gating:
//   Rails marks high-risk credentials (cloud providers that can spend money /
//   mutate infra, anything with meta.requires_approval = true) with
//   `requires_approval: true` in the response. When set, we pause the agent's
//   turn and surface a request_approval card to the human before handing the
//   value to the model. On reject the agent gets a "denied by user" error
//   it can recover from; on approve the value flows through normally and is
//   cached for the rest of the run so the user isn't re-prompted.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { createActionApproval } from "../security/action-approval.js";
import { emitActionApproval } from "../gateway.js";
import { host } from "../host/index.js";
import type { Origin } from "../channels/origin-delivery.js";
import { railsInternalUrl } from "../host/rails-url.js";
import { postProposal } from "./connections.js";

// Where the key came from. Capability MCP tools surface this so we can show
// "running on Double.md platform key" / "running on this agent's own key" in
// audit / UI. Rails resolves in order:
//   agent_owned → agent_grant → org_default → platform_default
export type CredentialSource =
  | "agent_owned"
  | "agent_grant"
  | "org_default"
  | "platform_default";

export interface SecretResponse {
  value: string;
  // Multi-field creds (AWS = access_key_id + secret_access_key + region,
  // Twilio = account_sid + auth_token, Stripe = secret_key + …) ship every
  // field here. Single-value creds (LLM keys, DigitalOcean) still populate
  // a one-entry map (`value` field).
  fields?: Record<string, string>;
  kind: string;
  provider: string;
  name: string;
  source?: CredentialSource;
  // Usage context the workspace owner pasted in. base_url tells the agent
  // where to POST; usage_md is a short markdown blob describing endpoints,
  // auth header shape, payload rules. Both flow into the tool result so
  // the agent has just-in-time docs without us building a per-API skill.
  base_url?: string | null;
  usage_md?: string | null;
  requires_approval?: boolean;
}

// Per-run in-memory cache so tight loops ("deploy then check status then
// deploy again") don't hammer Rails. The TTL is short to limit blast radius
// if the org rotates a key while a run is in flight.
const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { at: number; value: SecretResponse };
const cache = new Map<string, CacheEntry>();

// Once a user approves a particular high-risk credential during a run, skip
// re-prompting them for it. Resets per process so a fresh run starts fresh.
const approvedThisRun = new Set<string>();

function cacheKey(agentId: number, args: { name?: string; provider?: string; kind?: string }) {
  return `${agentId}|${args.name ?? ""}|${args.provider ?? ""}|${args.kind ?? ""}`;
}

function titleCaseLocal(s: string): string {
  return s.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface SecretsContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

export function buildSecretsMcpServer(ctx: SecretsContext) {
  const { agentId, orgId, origin } = ctx;
  const getTool = tool(
    "get",
    "Fetch a stored credential (cloud provider key, generic API key) that the workspace owner has shared with this agent. " +
      "Use this when you need to authenticate to a third-party service that isn't already wired through Composio — e.g. Heroku, Hetzner, custom APIs. " +
      "Pass `name` for a specific named secret OR `provider` (+ optional `kind`) for the org default. " +
      "If you get `no access`, the workspace owner hasn't granted this agent permission to use this credential — propose connecting it via the Credentials settings page instead of retrying. " +
      "High-risk credentials (cloud providers that can spend money) pause the turn for human approval before the value is returned.",
    {
      name: z.string().optional().describe(
        "Friendly name of the credential (e.g. 'production-aws', 'staging-heroku'). Use this when you know the exact label. Mutually exclusive with provider+kind."
      ),
      provider: z.string().optional().describe(
        "Provider slug — 'aws', 'heroku', 'hetzner', 'vercel', 'stripe', 'twilio', etc. Use when you want the org's default for that provider."
      ),
      kind: z.enum(["cloud_provider", "generic"]).optional().describe(
        "Credential kind. Defaults to 'cloud_provider'. LLM API keys are NEVER exposed here — they're piped into the agent's env at boot."
      ),
      purpose: z.string().optional().describe(
        "One short sentence explaining what you'll do with this credential. Surfaced on the approval card so the user knows what they're greenlighting."
      ),
    },
    async (args) => {
      if (!args.name && !args.provider) {
        return {
          content: [{ type: "text", text: "Pass either `name` or `provider` so I know which secret to fetch." }],
          isError: true,
        };
      }
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret) {
        return {
          content: [{ type: "text", text: "secrets.get: ENGINE_API_SECRET not set on the engine." }],
          isError: true,
        };
      }

      const ck = cacheKey(agentId, args);
      const cached = cache.get(ck);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return successResponse(cached.value);
      }

      const params = new URLSearchParams({ agent_id: String(agentId) });
      if (args.name)     params.set("name", args.name);
      if (args.provider) params.set("provider", args.provider);
      if (args.kind)     params.set("kind", args.kind);

      let data: SecretResponse;
      try {
        const res = await fetch(`${railsInternalUrl()}/api/secrets?${params.toString()}`, {
          headers: { "X-Engine-Secret": secret },
        });
        if (res.status === 403 || res.status === 404) {
          // Auto-post an inline 'Add <provider> credential' card via
          // the same propose_connection pipeline a Composio-OAuth gap
          // would use. Same UX shape: user gets a one-tap card in the
          // chat instead of plain text telling them to navigate
          // somewhere. ONE flow for all external access (OAuth + API
          // tokens + org secrets).
          const provider = (args.provider || args.name || "credential").toString().toLowerCase();
          await postProposal({
            ctx: { agentId, orgId, origin },
            slug: provider,
            label: titleCaseLocal(provider),
            why: args.purpose || (res.status === 403
              ? `to ${args.provider || args.name}-authenticated work`
              : `to authenticate to ${args.provider || args.name}`),
            kind: "api_credential",
          });
          const reason = res.status === 403
            ? "this agent isn't granted that credential yet"
            : `no ${args.provider || args.name} credential is configured in this workspace yet`;
          return {
            content: [{
              type: "text",
              text: `Posted an 'Add ${titleCaseLocal(provider)} credential' card — ${reason}. The user will paste their API token at /settings/credentials, then re-send the request. Don't retry until they confirm.`,
            }],
            isError: true,
          };
        }
        if (!res.ok) {
          const body = await res.text();
          return {
            content: [{ type: "text", text: `secrets.get failed: ${res.status} ${body.slice(0, 200)}` }],
            isError: true,
          };
        }

        data = (await res.json()) as SecretResponse;
      } catch (err) {
        logger.error("secrets.get fetch failed", { error: (err as Error).message });
        return {
          content: [{ type: "text", text: `secrets.get network error: ${(err as Error).message}` }],
          isError: true,
        };
      }

      // High-risk gate. Pause the turn until the human approves; pre-cache
      // their decision for the rest of the run so they don't get spammed by
      // a deploy-then-check-then-deploy loop.
      const credKey = `${data.kind}:${data.provider}:${data.name}`;
      if (data.requires_approval && !approvedThisRun.has(credKey)) {
        const decision = await gateWithApproval({
          ctx: { agentId, orgId, origin },
          cred: data,
          purpose: args.purpose,
        });
        if (decision === "rejected") {
          return {
            content: [{
              type: "text",
              text: `denied by user — they declined to share the ${data.name} credential. Don't retry; consider asking the user directly or doing the work some other way.`,
            }],
            isError: true,
          };
        }
        approvedThisRun.add(credKey);
      }

      cache.set(ck, { at: Date.now(), value: data });
      return successResponse(data);
    },
  );

  return createSdkMcpServer({
    name: "secrets",
    version: "1.0.0",
    tools: [getTool],
  });
}

// Programmatic secret fetch — used by capability providers (image_gen, tts,
// stt, browser) to resolve their API key WITHOUT going through the SDK tool
// wrapper. Returns null when no key is configured at any tier so the caller
// can either fall through to the next provider in its registry or return
// a graceful "no key configured" error.
//
// Bypasses the high-risk approval gate: capability providers are pre-approved
// by their `capabilities.<cap>.enabled` flag at the agent level. The gate
// is meant for ad-hoc cloud-provider secrets the agent decides to use mid-run.
export async function fetchSecret(opts: {
  agentId: number;
  provider: string;
  kind?: string; // default "generic"
}): Promise<SecretResponse | null> {
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) return null;

  const kind = opts.kind || "generic";
  const params = new URLSearchParams({
    agent_id: String(opts.agentId),
    provider: opts.provider,
    kind: kind,
  });

  try {
    const res = await fetch(`${railsInternalUrl()}/api/secrets?${params.toString()}`, {
      headers: { "X-Engine-Secret": secret },
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) {
      logger.warn(`fetchSecret(${opts.provider}) failed ${res.status}`);
      return null;
    }
    return (await res.json()) as SecretResponse;
  } catch (err) {
    logger.error(`fetchSecret(${opts.provider}) network error`, { error: (err as Error).message });
    return null;
  }
}

// Pushes a request_approval card to the chat and waits for the user's
// decision. Reuses the same `pending_approvals` table + cable event the
// generic request_approval tool uses, so the inline approval UI already
// renders it without any new frontend wiring.
async function gateWithApproval(opts: {
  ctx: SecretsContext;
  cred: SecretResponse;
  purpose?: string;
}): Promise<"approved" | "rejected"> {
  const { ctx, cred, purpose } = opts;
  const summary = `Hand the agent the ${cred.provider} credential “${cred.name}”${purpose ? ` — ${purpose}` : ""}`;
  const payload: Record<string, unknown> = {
    credential_kind: cred.kind,
    credential_provider: cred.provider,
    credential_name: cred.name,
    field_names: cred.fields ? Object.keys(cred.fields) : ["value"],
    purpose: purpose ?? null,
    _preview_markdown:
      `**Agent wants to use the ${cred.provider} credential \`${cred.name}\`.**\n\n` +
      (purpose ? `Why: ${purpose}\n\n` : "") +
      `Fields: ${(cred.fields ? Object.keys(cred.fields) : ["value"]).join(", ")}\n\n` +
      `Approving hands the value(s) to the model so it can call the upstream API. ` +
      `Reject if you'd rather do this manually.`,
  };
  const { id: localId, promise } = createActionApproval(summary, "destructive_action");

  try {
    const dbRow = await host.createPendingActionApproval({
      orgId: ctx.orgId,
      agentId: ctx.agentId,
      summary,
      payloadType: "destructive_action",
      payload,
      options: [
        { label: "Allow", value: "approve" },
        { label: "Deny", value: "reject" },
      ],
      riskTier: "high",
      approvalToken: localId,
      allowAmendment: false,
      origin: ctx.origin,
    });
    logger.info("secrets.get gated", {
      credential: `${cred.kind}:${cred.provider}:${cred.name}`,
      approval: localId,
      dbId: dbRow?.id,
    });
  } catch (err) {
    logger.warn("secrets.get: failed to persist approval row", { error: (err as Error).message });
  }

  emitActionApproval({
    approvalToken: localId,
    summary,
    payloadType: "destructive_action",
    payload,
    options: [
      { label: "Allow", value: "approve" },
      { label: "Deny", value: "reject" },
    ],
    riskTier: "high",
    allowAmendment: false,
  });

  const decision = await promise;
  return decision.value === "approve" ? "approved" : "rejected";
}

function successResponse(data: SecretResponse) {
  // Wrap the value(s) in a guardrail comment so the model is reminded not to
  // leak them into any user-facing assistant text. The SDK never persists tool
  // results into the message stream — they only show in the tool_history.
  const fieldsBlock = data.fields && Object.keys(data.fields).length > 0
    ? Object.entries(data.fields).map(([k, v]) => `${k}: ${v}`).join("\n")
    : `value: ${data.value}`;

  const contextBlock = [
    data.base_url ? `base_url: ${data.base_url}` : null,
    data.usage_md ? `\n## Usage notes\n${data.usage_md}` : null,
  ].filter(Boolean).join("\n");

  return {
    content: [{
      type: "text" as const,
      text:
        `Credential resolved.\n` +
        `name: ${data.name}\n` +
        `kind: ${data.kind}\n` +
        `provider: ${data.provider}\n` +
        `${fieldsBlock}\n` +
        (contextBlock ? `\n${contextBlock}\n` : "") +
        `\nDo not print these values back to the user. Use them in headers or environment-variable form when you make the upstream API call.`,
    }],
  };
}
