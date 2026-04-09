import fs from "fs";
import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import * as db from "./db.js";
import { redis } from "./queue.js";
import { syncMemoryToDb, readMemoryMd } from "./memory.js";
import { buildSubAgentDefinitions } from "./subagents.js";
import { createPermissionHook, createAuditHook } from "./permissions.js";
import { emitThinking, emitTextDelta, emitToolCall, emitToolResult, emitDone, emitError, emitApproval } from "./gateway.js";
import { setWhatsAppPendingReply } from "./channels/whatsapp.js";
import type { Agent, JobData, Message } from "./types.js";
import { logger } from "./logger.js";

export async function runAgent(agent: Agent, job: JobData): Promise<void> {
  // Set up channel reply if needed
  if (job.channel === "whatsapp" && job.payload?.from) {
    setWhatsAppPendingReply(job.payload.from);
  }
  logger.info(`Running agent: ${agent.name} (${agent.role})`, { jobType: job.type });

  // Check if this is an approval response (YES/NO) from a non-web channel
  if (job.type === "inbound_message" && job.channel && job.channel !== "web") {
    const body = (job.payload?.body || "").trim().toUpperCase();
    if (body === "YES" || body === "NO" || body === "APPROVE" || body === "REJECT") {
      const handled = await handleApprovalResponse(agent, job, body);
      if (handled) return;
    }
  }

  // Build conversation context
  let conversationId = job.conversationId;
  let history: Message[] = [];

  // If no conversation ID, create one for inbound messages
  if (!conversationId && job.type === "inbound_message" && job.payload?.from) {
    const conversation = await db.findOrCreateConversation(
      agent.id,
      agent.organization_id,
      "external",
      job.payload.from,
      job.payload.from,
      job.payload.from.includes("@") ? job.payload.from : undefined,
      !job.payload.from.includes("@") ? job.payload.from : undefined
    );
    conversationId = conversation.id;

    // Save the inbound message
    await db.saveMessage(
      conversationId,
      "user",
      job.payload.body || "",
      "inbound",
      job.channel,
      [],
      { from: job.payload.from, subject: job.payload.subject }
    );
  }

  if (conversationId) {
    history = await db.getConversationHistory(conversationId, 20);
  }

  // Build the prompt based on job type
  const prompt = buildPrompt(agent, job, history);

  // Build sub-agent definitions from DB
  const agents = await buildSubAgentDefinitions(agent);

  // Set up OpenRouter if configured
  if (config.anthropicBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl;
  }

  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    settingSources: ["project"],
    allowedTools: [
      "Skill",
      "Agent",
      "Read",
      "Write",
      "Grep",
      "Glob",
      "Bash",
      "WebSearch",
      "WebFetch",
      "Browser",
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  };

  // Add model if specified
  if (agent.ai_config?.model_id) {
    (options as any).model = agent.ai_config.model_id;
  }

  // Add sub-agents if any exist
  if (Object.keys(agents).length > 0) {
    (options as any).agents = agents;
  }

  try {
    let responseContent = "";
    const capturedEmails: Record<string, unknown>[] = [];

    // Broadcast: thinking
    emitThinking();

    for await (const message of query({ prompt, options: options as any })) {
      const msg = message as any;

      if (msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            responseContent = block.text;
            emitTextDelta(block.text);
          }
          if (block.type === "tool_use") {
            emitToolCall(block.name, block.input);
            // Capture Write calls to outbox — intercept email data
            if (block.name === "Write" && typeof block.input?.file_path === "string" && block.input.file_path.includes("outbox") && block.input.file_path.endsWith(".json")) {
              try {
                const emailData = JSON.parse(block.input.content || "{}");
                if (emailData.to) capturedEmails.push(emailData);
              } catch {}
            }
          }
          if (block.type === "tool_result") {
            const content = typeof block.content === "string" ? block.content : "done";
            emitToolResult(block.name || "tool", content);
          }
        }
      }

      if (msg.result) {
        responseContent = msg.result;
      }
    }

    // Save response to conversation FIRST (to get message ID for approvals)
    let savedMessageId: number | null = null;
    if (conversationId && responseContent) {
      const saved = await db.saveMessage(
        conversationId,
        "assistant",
        responseContent,
        "outbound",
        job.channel
      );
      savedMessageId = saved.id;
    }

    // Process email outbox BEFORE done (so approval events reach the client)
    const approvalResults = await processOutbox(agent, job, savedMessageId, capturedEmails);

    // For non-web channels, append draft preview to the response
    if (approvalResults.length > 0 && job.channel && job.channel !== "web") {
      const drafts = approvalResults.map((a) => {
        return `\n📧 *Email Draft* (Approval #${a.approvalId})\n` +
          `*To:* ${a.to}\n` +
          `*Subject:* ${a.subject}\n` +
          `---\n${a.body_text?.slice(0, 500)}${(a.body_text?.length || 0) > 500 ? "..." : ""}\n---\n` +
          `Reply *YES* to send, *NO* to cancel, or type feedback to revise.`;
      }).join("\n\n");
      responseContent += drafts;
    }

    // Broadcast: done
    emitDone(responseContent);

    // Log the action
    await db.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: prompt.slice(0, 500) },
      { response: responseContent.slice(0, 500) },
      "success"
    );

    // Sync memory back to DB (agent may have updated MEMORY.md)
    await syncMemoryToDb(agent.id);

    logger.info(`Agent run completed (${responseContent.length} chars)`);
  } catch (err) {
    emitError((err as Error).message);
    logger.error(`Agent run failed`, { error: (err as Error).message });
    await db.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: prompt.slice(0, 500) },
      { error: (err as Error).message },
      "failed"
    );
    throw err;
  }
}

function buildPrompt(agent: Agent, job: JobData, history: Message[]): string {
  const parts: string[] = [];

  // Inject memory directly into prompt
  const memory = readMemoryMd();
  if (memory && memory.trim() !== "# Memory\n\nNo memories yet.") {
    parts.push("## Your Memory (accumulated knowledge):\n" + memory + "\n");
  }
  parts.push("After this interaction, update memory/MEMORY.md with any new important facts you learn.\n");

  // Conversation history
  if (history.length > 0) {
    const senderName = job.payload?.from_name || job.payload?.from || "User";
    parts.push("## Conversation history with " + senderName + ":");
    for (const msg of history) {
      const role = msg.role === "user" ? senderName : agent.name;
      parts.push(`**${role}**: ${msg.content}`);
    }
    parts.push("");
  }

  // Current job
  switch (job.type) {
    case "inbound_message": {
      const from = job.payload?.from_name || job.payload?.from || "someone";
      const channel = job.channel || "message";
      parts.push(`New ${channel} from ${from}:`);
      if (job.payload?.subject) parts.push(`Subject: ${job.payload.subject}`);
      parts.push(`\n${job.payload?.body || ""}`);

      if (channel === "email") {
        parts.push("\nYou received this as an email. To reply, use the send-email skill:");
        parts.push("Write a JSON file to workspace/outbox/ with: to, cc, bcc, subject, body_text, body_html");
        parts.push(`Reply-To: ${job.payload?.from}`);
        parts.push("Maintain the subject thread. Be professional and use your personality.");
      } else {
        parts.push("\nRespond as yourself (not as an AI assistant). Use your personality and follow your instructions.");
      }
      break;
    }

    case "heartbeat":
      parts.push(job.payload?.instruction || "Heartbeat check — anything need attention?");
      break;

    case "scheduled_task":
      parts.push(`Scheduled task: ${job.payload?.instruction || "Execute your scheduled task."}`);
      break;

    case "task_assignment":
      parts.push(`You have been assigned a task:\n${job.payload?.instruction || ""}`);
      parts.push("\nComplete this task thoroughly and report your results.");
      break;
  }

  return parts.join("\n");
}

async function handleApprovalResponse(agent: Agent, job: JobData, response: string): Promise<boolean> {
  // Find the most recent pending approval for this agent
  const { rows } = await db.pool.query(
    `SELECT id, tool_name, tool_input FROM pending_approvals
     WHERE agent_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [agent.id]
  );

  if (rows.length === 0) return false;

  const approval = rows[0];
  const isApproved = response === "YES" || response === "APPROVE";
  const newStatus = isApproved ? "approved" : "rejected";

  // Update approval status
  await db.pool.query(
    `UPDATE pending_approvals SET status = $1, reviewed_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [newStatus, approval.id]
  );

  if (isApproved && approval.tool_name === "send_email") {
    // Push to outbound email queue
    const payload = typeof approval.tool_input === "string" ? JSON.parse(approval.tool_input) : approval.tool_input;
    payload.agent_id = agent.id;
    payload.org_id = agent.organization_id;
    await redis.lpush("outbound-email", JSON.stringify(payload));
    logger.info(`Approval #${approval.id} approved via ${job.channel}, email queued`);
  }

  // Send confirmation back through the channel
  const confirmMsg = isApproved
    ? `✅ Email approved and sending to ${(approval.tool_input as any)?.to || "recipient"}`
    : `❌ Email cancelled.`;

  emitDone(confirmMsg);
  logger.info(`Approval #${approval.id} ${newStatus} via ${job.channel}`);
  return true;
}

interface ApprovalResult {
  approvalId: number;
  to: string;
  subject: string;
  body_text: string;
}

async function processOutbox(agent: Agent, job: JobData, messageId?: number | null, capturedEmails?: Record<string, unknown>[]): Promise<ApprovalResult[]> {
  const results: ApprovalResult[] = [];
  // Get email channel config for from address
  const channels = await db.getChannelConfigs(String(agent.id));
  const emailConfig = channels.find(c => c.channel_type === "email");

  if (!emailConfig) {
    if (capturedEmails && capturedEmails.length > 0) {
      logger.warn("No email channel configured, skipping captured emails");
    }
    return results;
  }

  // Collect emails from both sources: files on disk + captured tool calls
  const emailsToProcess: Record<string, unknown>[] = [];

  // 1. Check outbox directory for files
  const outboxDir = path.join(config.dataDir, "workspace", "outbox");
  if (fs.existsSync(outboxDir)) {
    const files = fs.readdirSync(outboxDir).filter(f => f.endsWith(".json"));
    for (const file of files) {
      const filePath = path.join(outboxDir, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (content.to) emailsToProcess.push(content);
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error(`Failed to read outbox file ${file}`, { error: (err as Error).message });
      }
    }
  }

  // 2. Add captured emails from intercepted Write tool calls (fallback)
  if (capturedEmails) {
    for (const captured of capturedEmails) {
      // Dedupe: skip if we already have this email from a file
      const alreadyHave = emailsToProcess.some(e => e.to === captured.to && e.subject === captured.subject);
      if (!alreadyHave && captured.to) {
        emailsToProcess.push(captured);
      }
    }
  }

  if (emailsToProcess.length === 0) return results;

  // Process each email
  for (const content of emailsToProcess) {
    try {
      const emailPayload = {
        agent_id: agent.id,
        org_id: agent.organization_id,
        conversation_id: null, // Don't link to chat conversation
        to: content.to,
        cc: content.cc || [],
        bcc: content.bcc || [],
        subject: content.subject || "(no subject)",
        body_text: content.body_text || "",
        body_html: content.body_html || content.body_text || "",
        from_address: emailConfig.config.address as string,
        from_name: agent.name,
      };

      const permLevel = agent.permissions?.["send_email"] || "auto";

      if (permLevel === "never") {
        logger.info(`Email blocked by permissions: ${content.to}`);
      } else if (permLevel === "draft") {
        const approvalId = await db.savePendingApproval(
          agent.organization_id,
          agent.id,
          "send_email",
          emailPayload,
          `Email to ${content.to}: "${content.subject}"`,
          messageId || undefined
        );
        emitApproval(approvalId, "send_email", emailPayload);
        results.push({
          approvalId,
          to: content.to as string,
          subject: (content.subject || "(no subject)") as string,
          body_text: (content.body_text || "") as string,
        });
        logger.info(`Email queued for approval: ${content.to}`);
      } else {
        await redis.lpush("outbound-email", JSON.stringify(emailPayload));
        logger.info(`Email queued for send: ${content.to}`);
      }
    } catch (err) {
      logger.error(`Failed to process email to ${content.to}`, { error: (err as Error).message });
    }
  }
  return results;
}
