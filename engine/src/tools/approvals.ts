// Generic approval workflow MCP tool. Agents call request_approval before
// any user-visible irreversible action (publish post, send email batch,
// spend > $X, delete record). Pauses the turn until the user clicks a
// button on the channel they're on (Telegram inline keyboard, web
// approval card).
//
// Companion to security/action-approval.ts which holds the Promise map.
//
// Channel rendering: Telegram inline keyboard for now (web cards land in
// a follow-up). Renderers per payload_type live in channels/telegram.ts.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { createActionApproval } from "../security/action-approval.js";
import { emitActionApproval } from "../gateway.js";
import type { Origin } from "../channels/origin-delivery.js";

const PAYLOAD_TYPES = [
  "linkedin_post",
  "tweet",
  "email_draft",
  "cold_email_bulk",
  "spend_request",
  "external_share",
  "destructive_action",
  "generic",
] as const;

const RISK_TIERS = ["low", "medium", "high"] as const;

interface ApprovalsContext {
  agentId: number;
  orgId: number;
  origin?: Origin;
}

// Consults Rails for any matching standing-rule. Returns null when nothing
// matches, on network blip, or when env doesn't carry the Rails URL +
// secret. Caller falls back to the manual approval flow on null.
async function checkStandingRule(input: {
  orgId: number;
  agentId: number;
  payloadType: string;
  payload: Record<string, unknown>;
}): Promise<{ auto_decision: "approve" | "reject"; rule_id: string; label?: string } | null> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  if (!rails || !secret) return null;
  try {
    const res = await fetch(`${rails}/api/approval_rules/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Engine-Secret": secret,
      },
      body: JSON.stringify({
        org_id: input.orgId,
        agent_id: input.agentId,
        payload_type: input.payloadType,
        payload: input.payload,
      }),
      signal: AbortSignal.timeout(2_500),
    });
    if (res.status === 204 || !res.ok) return null;
    const body = await res.json() as { auto_decision?: string; rule_id?: string; label?: string };
    if (body?.auto_decision !== "approve" && body?.auto_decision !== "reject") return null;
    if (!body.rule_id) return null;
    return { auto_decision: body.auto_decision, rule_id: body.rule_id, label: body.label };
  } catch {
    return null;
  }
}

// Best-effort default risk tier when the agent didn't pick one. Heuristic:
// external publishing + spend over $500 + destructive → high; spend over $5
// + cold-email bulk → medium; everything else low. Agents can always
// override via the explicit `risk_tier` arg.
function inferRiskTier(
  payloadType: typeof PAYLOAD_TYPES[number],
  payload: Record<string, unknown>,
): "low" | "medium" | "high" {
  if (payloadType === "destructive_action") return "high";
  if (payloadType === "linkedin_post" || payloadType === "tweet") return "high";
  if (payloadType === "external_share") return "high";
  if (payloadType === "spend_request") {
    const amount = Number(payload.amount_usd ?? payload.amount ?? 0);
    if (amount >= 500) return "high";
    if (amount >= 5) return "medium";
    return "low";
  }
  if (payloadType === "cold_email_bulk") return "medium";
  if (payloadType === "email_draft") {
    // Internal vs external by recipient domain
    const to = String(payload.to ?? "");
    if (to.includes("@") && !to.endsWith("double.md") && !to.endsWith("scribemd.ai") && !to.endsWith("alchemy.ai")) return "medium";
    return "low";
  }
  return "medium";
}

export function buildApprovalsMcpServer(ctx: ApprovalsContext) {
  const requestApprovalTool = tool(
    "request_approval",
    "Request human approval before taking a user-visible irreversible action. Use for: publishing posts, sending email campaigns, spending money over a threshold, sharing externally, deleting records, or any action the user might want to review first. Pauses your turn until the user decides; the tool result tells you what they picked.",
    {
      summary: z.string().describe("One-line user-facing description: 'Publish post to LinkedIn', 'Send 12 cold emails', 'Spend $200 on LinkedIn ads'."),
      payload_type: z.enum(PAYLOAD_TYPES).describe(
        "Tells the channel renderer how to draw the preview. " +
        "linkedin_post / tweet / email_draft / cold_email_bulk / spend_request / external_share / destructive_action / generic.",
      ),
      payload: z.record(z.string(), z.any()).describe(
        "Rich preview JSON. Shape depends on payload_type, e.g. " +
        "linkedin_post: { text: '...', media_url?: '...' }, " +
        "email_draft: { to, subject, body }, " +
        "cold_email_bulk: { items: [{to, subject, body}, ...] }, " +
        "spend_request: { amount_usd, vendor, purpose }, " +
        "generic: { details: '...' }.",
      ),
      options: z.array(z.object({
        label: z.string().describe("Button label as the user sees it: 'Publish', 'Edit', 'Cancel'."),
        value: z.string().describe("The value returned to you in the tool result if the user picks this option."),
      })).optional().describe(
        "Buttons to offer the user. Defaults to [{label:'Approve',value:'approve'},{label:'Reject',value:'reject'}]. " +
        "Use this when you want a non-binary decision — e.g. a third 'Edit' button that returns 'edit' so you can re-draft.",
      ),
      risk_tier: z.enum(RISK_TIERS).optional().describe("low / medium / high — defaults to medium. Used for analytics + standing-rules auto-approval (low-risk may auto-approve in the future)."),
      allow_amendment: z.boolean().optional().describe("Set true if the user should be able to type a free-text amendment ('change the headline to X'). Returned in decision_text."),
      preview_markdown: z.string().optional().describe(
        "Universal human-readable preview of the action, in Markdown. Use this for ANY action type the dedicated renderers don't cover natively — slack_dm, calendar_invite, refund, feature flag toggle, code change, meeting reschedule, anything. Render the action as the user would want to read it: short title, key fields, the actual content, a one-line consequence statement. Always set this when payload_type='generic'.",
      ),
      preview_attachments: z.array(z.object({
        type: z.enum(["image", "link", "file", "audio", "video"]),
        url: z.string(),
        label: z.string().optional(),
      })).optional().describe(
        "Optional attachments for the preview card — screenshot mockups, links to the doc being shared, audio samples, etc. Rendered as chips/inline below the markdown.",
      ),
    },
    async (args) => {
      const options = args.options && args.options.length > 0
        ? args.options
        : [{ label: "Approve", value: "approve" }, { label: "Reject", value: "reject" }];
      // Auto-tier risk if the agent didn't supply one. External / financial /
      // destructive defaults to high; internal email / generic stays medium.
      // The agent can always override explicitly.
      const inferredRisk = inferRiskTier(args.payload_type, args.payload);
      const riskTier = args.risk_tier || inferredRisk;

      // Standing rules: ask Rails if any auto-decision rule matches before we
      // pause the turn. Rules return "approve" or "reject" and we resolve the
      // promise immediately. Falls back to manual approval when nothing matches
      // or the rules endpoint is unreachable.
      const standingRule = await checkStandingRule({
        orgId: ctx.orgId,
        agentId: ctx.agentId,
        payloadType: args.payload_type,
        payload: args.payload,
      }).catch(() => null);

      const { id: localId, promise } = createActionApproval(args.summary, args.payload_type);

      // Embed preview hints inside the persisted payload so they survive
      // round-trip through the DB to the side-panel render too.
      const enrichedPayload: Record<string, unknown> = { ...args.payload };
      if (args.preview_markdown) enrichedPayload._preview_markdown = args.preview_markdown;
      if (args.preview_attachments) enrichedPayload._preview_attachments = args.preview_attachments;

      try {
        // Tag the persisted row with the matching rule id so the
        // max-per-day predicate can count its own auto-decisions for the
        // day. Stored under enrichedPayload._matched_rule_id so it lands in
        // pending_approvals.tool_input where the predicate matcher reads.
        if (standingRule?.rule_id) enrichedPayload._matched_rule_id = standingRule.rule_id;

        const dbRow = await host.createPendingActionApproval({
          orgId: ctx.orgId,
          agentId: ctx.agentId,
          summary: args.summary,
          payloadType: args.payload_type,
          payload: enrichedPayload,
          options,
          riskTier,
          approvalToken: localId,
          allowAmendment: args.allow_amendment === true,
          origin: ctx.origin,
        });
        logger.info(`Approval requested: ${args.summary}`, { id: localId, dbId: dbRow?.id, payloadType: args.payload_type, autoRule: standingRule?.rule_id });

        // Standing-rule auto-decision short-circuits the user prompt.
        // Mark the DB row decided so the audit trail stays consistent,
        // then resolve the promise locally without ever emitting the
        // approval card.
        if (standingRule) {
          if (dbRow?.id) {
            await host.updatePendingApprovalDecision(dbRow.id, {
              status: standingRule.auto_decision === "approve" ? "approved" : "rejected",
              decision: standingRule.auto_decision,
              decisionText: standingRule.label ? `Auto-decided by rule: ${standingRule.label}` : "Auto-decided",
            }).catch((err) => logger.warn("Failed to mark auto-decided approval", { error: (err as Error).message }));
          }
          return {
            content: [{
              type: "text",
              text: `User decision: ${standingRule.auto_decision} (auto, rule: ${standingRule.label || standingRule.rule_id})`,
            }],
          };
        }

        // Push the inline card to the chat thread (web channel listens via
        // AgentChatChannel; Telegram delivery handled in a separate hop).
        emitActionApproval({
          approvalToken: localId,
          summary: args.summary,
          payloadType: args.payload_type,
          payload: enrichedPayload,
          options,
          riskTier,
          allowAmendment: args.allow_amendment === true,
        });

        const decision = await promise;
        return {
          content: [{
            type: "text",
            text: decision.text
              ? `User decision: ${decision.value} — amendment: ${decision.text}`
              : `User decision: ${decision.value}`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Approval failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "approvals",
    version: "0.1.0",
    tools: [requestApprovalTool],
  });
}
