import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { host } from "../host/index.js";
import { emitApproval } from "../gateway.js";
import { logger } from "../logger.js";
import { uploadAttachment } from "./attachment-uploader.js";
import type { Agent, JobData } from "../types.js";
import type { CapturedEmail } from "../tool-interceptor.js";

export interface ApprovalResult {
  approvalId: number;
  to: string;
  subject: string;
  body_text: string;
}

// Processes the email outbox after an agent run.
// Combines files written to disk + emails captured from tool calls.
// Routes each email through the permission system: never / draft (approval) / auto (send).
export async function processOutbox(
  agent: Agent,
  job: JobData,
  messageId?: number | null,
  capturedEmails?: CapturedEmail[],
): Promise<ApprovalResult[]> {
  const results: ApprovalResult[] = [];

  const channels = await host.getChannelConfigs(String(agent.id));
  const emailConfig = channels.find((c) => c.channel_type === "email");

  if (!emailConfig) {
    if (capturedEmails && capturedEmails.length > 0) {
      logger.warn("No email channel configured, skipping captured emails");
    }
    return results;
  }

  const emailsToProcess = collectEmails(capturedEmails);
  if (emailsToProcess.length === 0) return results;

  for (const content of emailsToProcess) {
    try {
      const result = await processOneEmail(content, agent, emailConfig, messageId);
      if (result) results.push(result);
    } catch (err) {
      logger.error(`Failed to process email to ${content.to}`, { error: (err as Error).message });
    }
  }

  return results;
}

// Combines emails from disk (workspace/outbox/*.json) and captured Write tool calls.
// Deduplicates by to+subject.
function collectEmails(capturedEmails?: CapturedEmail[]): CapturedEmail[] {
  const emails: CapturedEmail[] = [];

  // 1. Read files from disk and delete them
  const outboxDir = path.join(config.dataDir, "workspace", "outbox");
  if (fs.existsSync(outboxDir)) {
    const files = fs.readdirSync(outboxDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(outboxDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CapturedEmail;
        if (content.to) emails.push(content);
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error(`Failed to read outbox file ${file}`, { error: (err as Error).message });
      }
    }
  }

  // 2. Add captured emails (deduped against disk)
  if (capturedEmails) {
    for (const captured of capturedEmails) {
      const dupe = emails.some((e) => e.to === captured.to && e.subject === captured.subject);
      if (!dupe && captured.to) emails.push(captured);
    }
  }

  return emails;
}

async function processOneEmail(
  content: CapturedEmail,
  agent: Agent,
  emailConfig: { config: Record<string, unknown> },
  messageId?: number | null,
): Promise<ApprovalResult | null> {
  // Upload attachments if specified
  const attachmentIds: string[] = [];
  if (Array.isArray(content.attachments)) {
    for (const relPath of content.attachments) {
      const id = await uploadAttachment(relPath);
      if (id) attachmentIds.push(id);
    }
  }

  const emailPayload = {
    agent_id: agent.id,
    org_id: agent.organization_id,
    conversation_id: null,
    to: content.to,
    cc: content.cc || [],
    bcc: content.bcc || [],
    subject: content.subject || "(no subject)",
    body_text: content.body_text || "",
    body_html: content.body_html || content.body_text || "",
    from_address: emailConfig.config.address as string,
    from_name: agent.name,
    attachment_ids: attachmentIds,
  };

  const permLevel = agent.permissions?.["send_email"] || "auto";

  if (permLevel === "never") {
    logger.info(`Email blocked by permissions: ${content.to}`);
    return null;
  }

  if (permLevel === "draft") {
    const approvalId = await host.savePendingApproval(
      agent.organization_id,
      agent.id,
      "send_email",
      emailPayload,
      `Email to ${content.to}: "${content.subject}"`,
      messageId || undefined,
    );
    emitApproval(approvalId, "send_email", emailPayload);
    logger.info(`Email queued for approval: ${content.to}`);
    return {
      approvalId,
      to: content.to,
      subject: content.subject || "(no subject)",
      body_text: content.body_text || "",
    };
  }

  // auto: send immediately via host (Rails enqueues SendEmailJob)
  await host.sendEmail(emailPayload);
  logger.info(`Email sent: ${content.to}`);
  return null;
}
