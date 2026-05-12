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
//   - No approval gating yet — Rails-side ACL is the only barrier. Per-fetch
//     approval is a follow-up phase.
//
// The agent should call this for things like:
//   "I need to deploy this to Heroku" → secrets.get({ provider: "heroku" })
//   "Charge the customer in Stripe"   → secrets.get({ provider: "stripe" })
//   "Use my prod AWS keys"            → secrets.get({ name: "aws-prod" })

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";

interface SecretResponse {
  value: string;
  // Multi-field creds (AWS = access_key_id + secret_access_key + region,
  // Twilio = account_sid + auth_token, Stripe = secret_key + …) ship every
  // field here. Single-value creds (LLM keys, DigitalOcean) still populate
  // a one-entry map (`value` field).
  fields?: Record<string, string>;
  kind: string;
  provider: string;
  name: string;
}

function railsUrl(): string {
  return (
    process.env.RAILS_INTERNAL_URL ||
    process.env.RAILS_API_URL ||
    "http://localhost:3200"
  );
}

// Per-run in-memory cache so tight loops ("deploy then check status then
// deploy again") don't hammer Rails. The TTL is short to limit blast radius
// if the org rotates a key while a run is in flight.
const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { at: number; value: SecretResponse };
const cache = new Map<string, CacheEntry>();

function cacheKey(agentId: number, args: { name?: string; provider?: string; kind?: string }) {
  return `${agentId}|${args.name ?? ""}|${args.provider ?? ""}|${args.kind ?? ""}`;
}

export function buildSecretsMcpServer(agentId: number) {
  const getTool = tool(
    "get",
    "Fetch a stored credential (cloud provider key, generic API key) that the workspace owner has shared with this agent. " +
      "Use this when you need to authenticate to a third-party service that isn't already wired through Composio — e.g. Heroku, Hetzner, custom APIs. " +
      "Pass `name` for a specific named secret OR `provider` (+ optional `kind`) for the org default. " +
      "If you get `no access`, the workspace owner hasn't granted this agent permission to use this credential — propose connecting it via the Credentials settings page instead of retrying.",
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

      try {
        const res = await fetch(`${railsUrl()}/api/secrets?${params.toString()}`, {
          headers: { "X-Engine-Secret": secret },
        });
        if (res.status === 403) {
          return {
            content: [{
              type: "text",
              text: "no access — this agent hasn't been granted that credential. The user can grant it from Edit Agent → Permissions → Credentials.",
            }],
            isError: true,
          };
        }
        if (res.status === 404) {
          return {
            content: [{
              type: "text",
              text: "not found — no credential matches that name/provider in this workspace. The user can add one at /settings/credentials.",
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

        const data = (await res.json()) as SecretResponse;
        cache.set(ck, { at: Date.now(), value: data });
        return successResponse(data);
      } catch (err) {
        logger.error("secrets.get fetch failed", { error: (err as Error).message });
        return {
          content: [{ type: "text", text: `secrets.get network error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "secrets",
    version: "1.0.0",
    tools: [getTool],
  });
}

function successResponse(data: SecretResponse) {
  // Wrap the value(s) in a guardrail comment so the model is reminded not to
  // leak them into any user-facing assistant text. The SDK never persists tool
  // results into the message stream — they only show in the tool_history.
  const fieldsBlock = data.fields && Object.keys(data.fields).length > 0
    ? Object.entries(data.fields).map(([k, v]) => `${k}: ${v}`).join("\n")
    : `value: ${data.value}`;

  return {
    content: [{
      type: "text" as const,
      text:
        `Credential resolved.\n` +
        `name: ${data.name}\n` +
        `kind: ${data.kind}\n` +
        `provider: ${data.provider}\n` +
        `${fieldsBlock}\n\n` +
        `Do not print these values back to the user. Use them in headers or environment-variable form when you make the upstream API call.`,
    }],
  };
}
