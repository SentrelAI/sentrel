import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import * as db from "./db.js";
import { syncMemoryToDb } from "./memory.js";
import { buildSubAgentDefinitions } from "./subagents.js";
import { buildPrompt } from "./prompt-builder.js";
import { ToolInterceptor } from "./tool-interceptor.js";
import { processOutbox } from "./email/outbox-processor.js";
import { maybeHandleApprovalResponse, formatChannelApprovalPreview } from "./email/approval-handler.js";
import {
  emitThinking,
  emitTextDelta,
  emitToolCall,
  emitToolResult,
  emitDone,
  emitError,
} from "./gateway.js";
import { setWhatsAppPendingReply } from "./channels/whatsapp.js";
import type { Agent, JobData, Message } from "./types.js";
import { logger } from "./logger.js";

// Top-level orchestrator: routes a job to the right handler and runs the
// Claude Agent SDK loop. Heavy lifting (prompt, outbox, approvals) lives in
// dedicated modules.
export async function runAgent(agent: Agent, job: JobData): Promise<void> {
  if (job.channel === "whatsapp" && job.payload?.from) {
    setWhatsAppPendingReply(job.payload.from);
  }
  logger.info(`Running agent: ${agent.name} (${agent.role})`, { jobType: job.type });

  // Short-circuit: YES/NO replies on non-web channels are approval responses,
  // not new prompts. Handle them and skip the agent run entirely.
  if (await maybeHandleApprovalResponse(agent, job)) return;

  const conversationId = await ensureConversation(agent, job);
  const history = conversationId ? await db.getConversationHistory(conversationId, 20) : [];
  const prompt = buildPrompt(agent, job, history);

  const options = await buildQueryOptions(agent);

  try {
    const result = await runAgentLoop(prompt, options);

    // Save the assistant's response so future runs see it in history
    let savedMessageId: number | null = null;
    if (conversationId && result.responseContent) {
      const saved = await db.saveMessage(
        conversationId,
        "assistant",
        result.responseContent,
        "outbound",
        job.channel,
      );
      savedMessageId = saved.id;
    }

    // Process any emails the agent drafted (outbox files + intercepted Write calls)
    const approvalResults = await processOutbox(
      agent,
      job,
      savedMessageId,
      result.interceptor.capturedEmails(),
    );

    // For non-web channels, append approval prompts to the response so the
    // user can reply YES/NO directly in their channel
    let finalResponse = result.responseContent;
    if (approvalResults.length > 0 && job.channel && job.channel !== "web") {
      finalResponse += formatChannelApprovalPreview(approvalResults);
    }

    emitDone(finalResponse);

    await db.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: prompt.slice(0, 500) },
      { response: finalResponse.slice(0, 500) },
      "success",
    );

    await syncMemoryToDb(agent.id);
    logger.info(`Agent run completed (${finalResponse.length} chars)`);
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
      "failed",
    );
    throw err;
  }
}

// ── Internals ──────────────────────────────────────────────────

interface QueryResult {
  responseContent: string;
  interceptor: ToolInterceptor;
}

async function runAgentLoop(prompt: string, options: Record<string, unknown>): Promise<QueryResult> {
  const interceptor = new ToolInterceptor();
  let responseContent = "";

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
          interceptor.observe(block);
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

  return { responseContent, interceptor };
}

async function ensureConversation(agent: Agent, job: JobData): Promise<number | undefined> {
  if (job.conversationId) return job.conversationId;
  if (job.type !== "inbound_message" || !job.payload?.from) return undefined;

  const conversation = await db.findOrCreateConversation(
    agent.id,
    agent.organization_id,
    "external",
    job.payload.from,
    job.payload.from,
    job.payload.from.includes("@") ? job.payload.from : undefined,
    !job.payload.from.includes("@") ? job.payload.from : undefined,
  );

  await db.saveMessage(
    conversation.id,
    "user",
    job.payload.body || "",
    "inbound",
    job.channel,
    [],
    { from: job.payload.from, subject: job.payload.subject },
  );

  return conversation.id;
}

async function buildQueryOptions(agent: Agent): Promise<Record<string, unknown>> {
  const subAgents = await buildSubAgentDefinitions(agent);

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

  if (agent.ai_config?.model_id) {
    options.model = agent.ai_config.model_id;
  }
  if (Object.keys(subAgents).length > 0) {
    options.agents = subAgents;
  }

  return options;
}
