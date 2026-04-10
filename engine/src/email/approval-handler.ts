import * as db from "../db.js";
import { redis } from "../queue.js";
import { emitDone } from "../gateway.js";
import { logger } from "../logger.js";
import type { Agent, JobData } from "../types.js";

const APPROVAL_KEYWORDS = new Set(["YES", "NO", "APPROVE", "REJECT"]);

// Detects YES/NO/APPROVE/REJECT replies on non-web channels and processes
// the most recent pending approval. Returns true if the message was an
// approval response and was handled (caller should not run the agent).
export async function maybeHandleApprovalResponse(agent: Agent, job: JobData): Promise<boolean> {
  if (job.type !== "inbound_message") return false;
  if (!job.channel || job.channel === "web") return false;

  const body = (job.payload?.body || "").trim().toUpperCase();
  if (!APPROVAL_KEYWORDS.has(body)) return false;

  const isApproved = body === "YES" || body === "APPROVE";
  return await applyApproval(agent, job, isApproved);
}

async function applyApproval(agent: Agent, job: JobData, isApproved: boolean): Promise<boolean> {
  const { rows } = await db.pool.query(
    `SELECT id, tool_name, tool_input FROM pending_approvals
     WHERE agent_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [agent.id],
  );

  if (rows.length === 0) return false;

  const approval = rows[0];
  const newStatus = isApproved ? "approved" : "rejected";

  await db.pool.query(
    `UPDATE pending_approvals SET status = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [newStatus, approval.id],
  );

  if (isApproved && approval.tool_name === "send_email") {
    const payload = typeof approval.tool_input === "string"
      ? JSON.parse(approval.tool_input)
      : approval.tool_input;
    payload.agent_id = agent.id;
    payload.org_id = agent.organization_id;
    await redis.lpush("outbound-email", JSON.stringify(payload));
    logger.info(`Approval #${approval.id} approved via ${job.channel}, email queued`);
  }

  const recipient = (approval.tool_input as { to?: string })?.to || "recipient";
  const confirmMsg = isApproved
    ? `✅ Email approved and sending to ${recipient}`
    : `❌ Email cancelled.`;

  emitDone(confirmMsg);
  logger.info(`Approval #${approval.id} ${newStatus} via ${job.channel}`);
  return true;
}

// Formats approval previews for non-web channels (WhatsApp, Telegram).
// Appended to the agent's response so the user can reply YES/NO.
export function formatChannelApprovalPreview(results: Array<{ approvalId: number; to: string; subject: string; body_text: string }>): string {
  return results.map((a) => {
    const preview = a.body_text?.slice(0, 500) || "";
    const ellipsis = (a.body_text?.length || 0) > 500 ? "..." : "";
    return `\n📧 *Email Draft* (Approval #${a.approvalId})\n` +
      `*To:* ${a.to}\n` +
      `*Subject:* ${a.subject}\n` +
      `---\n${preview}${ellipsis}\n---\n` +
      `Reply *YES* to send, *NO* to cancel, or type feedback to revise.`;
  }).join("\n\n");
}
