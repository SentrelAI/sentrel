import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { host } from "./host/index.js";
import { syncMemoryToDb } from "./memory.js";
import { buildSubAgentDefinitions } from "./subagents.js";
import { buildPrompt } from "./prompt-builder.js";
import { buildSystemPrompt } from "./system-prompt-builder.js";
import { summarizeConversation } from "./summarizer.js";
import { processAttachments } from "./media/pipeline.js";
import { syncSkillsFromDb } from "./skills.js";
import { buildRecallMcpServer } from "./tools/recall.js";
import { buildSendMediaMcpServer } from "./tools/send-media.js";
import { getComposioMcpServer } from "./integrations/composio.js";
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
  consumePendingMedia,
} from "./gateway.js";
import { setWhatsAppPendingReply } from "./channels/whatsapp.js";
import type { Agent, Conversation, JobData, Message } from "./types.js";
import { logger } from "./logger.js";

// Sprint 0b — session rotation thresholds
const SESSION_TURN_CAP = 30;
const SESSION_TIME_GAP_HOURS = 24;

// Top-level orchestrator: routes a job to the right handler and runs the
// Claude Agent SDK loop. Heavy lifting (prompt, outbox, approvals, summarization)
// lives in dedicated modules.
export async function runAgent(agent: Agent, job: JobData): Promise<void> {
  if (job.channel === "whatsapp" && job.payload?.from) {
    setWhatsAppPendingReply(job.payload.from);
  }
  logger.info(`Running agent: ${agent.name} (${agent.role})`, { jobType: job.type });

  // Short-circuit: YES/NO replies on non-web channels are approval responses,
  // not new prompts. Handle them and skip the agent run entirely.
  if (await maybeHandleApprovalResponse(agent, job)) return;

  // ── Conversation lookup (only inbound_message jobs have conversations) ──
  const isInbound = job.type === "inbound_message";
  let conversation: Conversation | null = null;
  if (job.conversationId) {
    conversation = await host.getConversation(job.conversationId);
  } else if (isInbound && job.payload?.from) {
    conversation = await host.findOrCreateConversation(
      agent.id,
      agent.organization_id,
      "external",
      job.payload.from,
      job.payload.from,
      job.payload.from.includes("@") ? job.payload.from : undefined,
      !job.payload.from.includes("@") ? job.payload.from : undefined,
    );
  }

  // ── Session resume / rotation decision (inbound only) ──
  // CRITICAL: this read must happen BEFORE we save the new user message,
  // because saving bumps last_message_at which would defeat the time-gap check.
  let resumeSessionId: string | null = null;
  let priorTurnCount = 0;

  // TODO: SDK session resume is disabled. The SDK loads the ENTIRE previous
  // session transcript (including all tool calls), which can balloon context
  // and cause multi-minute hangs. The DB history injection (last 20 messages
  // + summaries) provides continuity without this overhead. Re-enable once
  // we understand the SDK's session size characteristics.
  const RESUME_ENABLED = false;

  if (isInbound && conversation) {
    if (shouldResumeSession(conversation)) {
      // Session is still valid (within turn cap + time gap) — continue it
      priorTurnCount = conversation.claude_session_turn_count ?? 0;
      if (RESUME_ENABLED) {
        resumeSessionId = conversation.claude_session_id ?? null;
        logger.info(
          `Resuming session for conversation ${conversation.id} (turn ${priorTurnCount + 1}/${SESSION_TURN_CAP})`
        );
      }
    } else if (conversation.claude_session_id) {
      // Session expired (turn cap OR time gap) — summarize before rotating
      const reason =
        (conversation.claude_session_turn_count ?? 0) >= SESSION_TURN_CAP
          ? "turn cap"
          : "time gap";
      logger.info(
        `Rotating session for conversation ${conversation.id} (reason: ${reason})`
      );
      const summary = await summarizeConversation(
        agent,
        conversation.id,
        1,
        conversation.claude_session_turn_count ?? 0,
      );
      if (summary) {
        await host.appendConversationSummary(conversation.id, summary);
        logger.info(
          `Conversation ${conversation.id} summarized (${summary.summary.length} chars, range ${summary.turn_range})`
        );
      }
    }
  }

  // ── Save the inbound user message (NOW it's safe to bump last_message_at) ──
  // Skip if conversationId was provided in the job — that means the channel
  // webhook (e.g. Rails /webhooks/web) already saved the user message before
  // enqueueing. Only save here for engine-polled channels (telegram) or
  // channels that don't pre-save (whatsapp via Rails webhook doesn't save
  // the message, it just enqueues).
  const railsAlreadySaved = !!job.conversationId;
  if (isInbound && conversation && job.payload?.body !== undefined && !railsAlreadySaved) {
    const attachmentIds = job.payload.attachment_ids || [];
    await host.saveMessage(
      conversation.id,
      "user",
      job.payload.body || "",
      "inbound",
      job.channel,
      [],
      {
        from: job.payload.from,
        subject: job.payload.subject,
        ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
      },
    );
  }

  // ── Refetch conversation so prompt sees the new summary ──
  // (only needed if we just appended a summary)
  if (conversation && resumeSessionId === null && conversation.claude_session_id) {
    conversation = await host.getConversation(conversation.id);
  }

  // ── Sprint 6: sync skills from DB to workspace ──
  const skills = await syncSkillsFromDb(agent.id);

  // ── Sprint 2: process media attachments (transcribe audio, save files) ──
  const attachmentIds = job.payload?.attachment_ids || [];
  const processedMedia = attachmentIds.length > 0
    ? await processAttachments(attachmentIds)
    : [];

  // ── Build prompt with refreshed history + summaries + processed media ──
  const conversationId = conversation?.id;
  const history = conversationId ? await host.getConversationHistory(conversationId, 20) : [];
  const built = buildPrompt(agent, job, history, conversation, processedMedia);

  const options = await buildQueryOptions(agent, job);
  options.systemPrompt = buildSystemPrompt(agent, skills);
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  try {
    const result = await runAgentLoop(built.promptText, options);

    // ── Persist captured session ID for future resumption ──
    if (isInbound && conversation && result.capturedSessionId) {
      const newTurnCount = resumeSessionId ? priorTurnCount + 1 : 1;
      await host.updateConversationSessionId(
        conversation.id,
        result.capturedSessionId,
        newTurnCount,
      );
    }

    // Save the assistant's response so future runs see it in history
    // Include any media the agent sent during this run so they persist on refresh
    const sentMedia = consumePendingMedia();
    let savedMessageId: number | null = null;
    if (conversationId && result.responseContent) {
      const saved = await host.saveMessage(
        conversationId,
        "assistant",
        result.responseContent,
        "outbound",
        job.channel,
        [],
        sentMedia.length > 0
          ? {
              media: sentMedia.map((m) => ({
                url: m.url,
                filename: m.filename,
                contentType: m.contentType,
                signedId: m.signedId,
              })),
            }
          : undefined,
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

    // For non-web channels, show approval prompts.
    // Telegram: inline keyboard buttons (tap to approve/reject)
    // WhatsApp: text with "Reply YES/NO" (no button support in sandbox)
    let finalResponse = result.responseContent;
    if (approvalResults.length > 0 && job.channel && job.channel !== "web") {
      if (job.channel === "telegram" && job.payload?.metadata?.bot_token && job.payload?.metadata?.chat_id) {
        // Telegram: send separate messages with inline buttons for each approval
        const { sendWithButtons } = await import("./channels/telegram.js");
        for (const a of approvalResults) {
          const preview = a.body_text?.slice(0, 300) || "";
          const text =
            `📧 *Email Draft*\n` +
            `*To:* ${a.to}\n` +
            `*Subject:* ${a.subject}\n` +
            `---\n${preview}${preview.length < (a.body_text?.length || 0) ? "..." : ""}\n---`;
          await sendWithButtons(
            job.payload.metadata.bot_token as string,
            job.payload.metadata.chat_id as number,
            text,
            [[
              { text: "✅ Send", callback_data: `approve_${a.approvalId}` },
              { text: "❌ Cancel", callback_data: `reject_${a.approvalId}` },
            ]],
          );
        }
      } else {
        // Other channels: text-based YES/NO
        finalResponse += formatChannelApprovalPreview(approvalResults);
      }
    }

    emitDone(finalResponse);

    await host.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: built.promptText.slice(0, 500) },
      { response: finalResponse.slice(0, 500), session_id: result.capturedSessionId, resumed: resumeSessionId !== null },
      "success",
    );

    await syncMemoryToDb(agent.id);
    logger.info(`Agent run completed (${finalResponse.length} chars)`);
  } catch (err) {
    emitError((err as Error).message);
    logger.error(`Agent run failed`, { error: (err as Error).message });
    await host.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: built.promptText.slice(0, 500) },
      { error: (err as Error).message },
      "failed",
    );
    throw err;
  }
}

// Decide whether to resume the existing Claude session for a conversation,
// or rotate to a fresh one. Rotation triggers on EITHER turn cap OR time gap.
function shouldResumeSession(conversation: Conversation): boolean {
  if (!conversation.claude_session_id) return false;
  if ((conversation.claude_session_turn_count ?? 0) >= SESSION_TURN_CAP) return false;
  if (conversation.last_message_at) {
    const hoursSince =
      (Date.now() - new Date(conversation.last_message_at).getTime()) / 3_600_000;
    if (hoursSince > SESSION_TIME_GAP_HOURS) return false;
  }
  return true;
}

// ── Internals ──────────────────────────────────────────────────

interface QueryResult {
  responseContent: string;
  interceptor: ToolInterceptor;
  capturedSessionId: string | null;
}

async function runAgentLoop(
  promptText: string,
  options: Record<string, unknown>,
): Promise<QueryResult> {
  const interceptor = new ToolInterceptor();
  let responseContent = "";
  let capturedSessionId: string | null = null;

  emitThinking();

  // Pass as a plain string for now. Sprint 0c's content-block shape is
  // preserved in prompt-builder for future multimodal use (Sprint 2), but
  // the SDK's async generator input form caused hangs in practice.
  // When Sprint 2 needs image/document blocks, we'll switch to the
  // Anthropic Messages API directly instead of the Claude Agent SDK wrapper.
  for await (const message of query({ prompt: promptText, options: options as any })) {
    const msg = message as any;

    // Capture sessionId from the first message that has one (per sdk.d.ts:2467+,
    // every SDKMessage has session_id, and the first is always SDKSystemMessage
    // with subtype: "init" containing it)
    if (!capturedSessionId && msg.session_id) {
      capturedSessionId = msg.session_id;
    }

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

  return { responseContent, interceptor, capturedSessionId };
}

async function buildQueryOptions(
  agent: Agent,
  job: JobData,
): Promise<Record<string, unknown>> {
  const subAgents = await buildSubAgentDefinitions(agent);

  if (config.anthropicBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl;
  }

  // Sprint 0e — recall tool (tenant-scoped)
  const recallServer = buildRecallMcpServer(agent.organization_id);

  // Sprint 3 — send media tools (channel + metadata baked in)
  // Read bot number from channel config so WhatsApp From number is correct
  const channelConfigs = await host.getChannelConfigs(String(agent.id));
  const waConfig = channelConfigs.find((c) => c.channel_type === "whatsapp");
  const channelMeta = {
    ...(job.payload?.metadata || {}),
    from: job.payload?.from,
    bot_number: waConfig?.config?.phone_number || process.env.WHATSAPP_BOT_NUMBER || "",
  };
  const sendMediaServer = buildSendMediaMcpServer(job.channel || "web", channelMeta);

  // Sprint 6 — Composio integration (1000+ app tools)
  const composioServer = await getComposioMcpServer(agent.organization_id);

  const mcpServers: Record<string, unknown> = {
    recall: recallServer,
    "send-media": sendMediaServer,
  };
  if (composioServer) {
    mcpServers.composio = composioServer;
  }

  const options: Record<string, unknown> = {
    cwd: config.dataDir,
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
      // Custom MCP tools
      "mcp__recall__search_messages",
      "mcp__send-media__send_voice",
      "mcp__send-media__send_image",
      "mcp__send-media__send_file",
      // Composio tools: allow all (wildcard)
      ...(composioServer ? ["mcp__composio__*"] : []),
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers,
  };

  if (agent.ai_config?.model_id) {
    options.model = agent.ai_config.model_id;
  }
  if (Object.keys(subAgents).length > 0) {
    options.agents = subAgents;
  }

  return options;
}
