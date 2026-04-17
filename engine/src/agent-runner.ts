import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
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
import { buildSchedulingMcpServer } from "./tools/scheduling.js";
import { buildTasksMcpServer } from "./tools/tasks.js";
import { getComposioMcpServer, getActiveToolkits } from "./integrations/composio.js";
import { routeToolkits } from "./integrations/router.js";
import { scanCommand } from "./security/command-scanner.js";
import { createCommandApproval, type ApprovalLevel } from "./security/command-approval.js";
import { recordApproval } from "./security/approval-interceptor.js";
import { redactSecrets } from "./security/credential-filter.js";
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
  const startTime = Date.now();

  // Correlation ID — generated at enqueue time by channel handlers so they can
  // pre-register an onDone listener keyed to this job. If missing (older
  // enqueue paths), synthesize one; the job will still run, but no channel
  // listener exists for it, so emitDone will log a drop warning.
  if (!job.jobId) {
    job.jobId = randomUUID();
    logger.warn(`runAgent: job arrived without jobId, synthesized ${job.jobId} — response won't be dispatched to a channel listener`);
  }
  const jobId = job.jobId;

  if (job.channel === "whatsapp" && job.payload?.from) {
    setWhatsAppPendingReply(jobId, job.payload.from);
  }
  logger.info(`Running agent: ${agent.name} (${agent.role})`, { jobType: job.type, jobId });

  // Short-circuit: YES/NO replies on non-web channels are approval responses,
  // not new prompts. Handle them and skip the agent run entirely.
  if (await maybeHandleApprovalResponse(agent, job, jobId)) return;

  // ── Task assignment: mark as in_progress immediately (unless explicitly skipped) ──
  if (job.type === "task_assignment" && job.payload?.taskId && !job.payload?.skipAutoComplete) {
    await host.updateTask(job.payload.taskId, { status: "in_progress" }).catch(() => {});
  }

  // ── Heartbeat: inject pending tasks or skip if nothing to do ──
  if (job.type === "heartbeat") {
    const pendingTasks = await host.listTasks(agent.id, "todo");
    if (pendingTasks.length === 0) {
      await host.saveAuditLog(agent.organization_id, agent.id, "heartbeat", undefined, { skipped: true }, { response: "HEARTBEAT_OK" }, "success");
      logger.info("Heartbeat: nothing pending, skipped agent call");
      return;
    }
    const taskList = pendingTasks.map((t, i) =>
      `  ${i + 1}. [${t.priority}] "${t.title}" (ID: ${t.id})${t.due_at ? ` — due ${new Date(t.due_at).toLocaleDateString()}` : ""}`
    ).join("\n");
    job = {
      ...job,
      payload: {
        ...job.payload,
        instruction: (job.payload?.instruction || "") +
          `\n\nYou have ${pendingTasks.length} pending task(s):\n${taskList}\n\n` +
          `For each task, call update_task to set status to "in_progress", work on it, then set status to "done" and use comment_on_task with your findings.`,
      },
    };
  }

  // ── Conversation lookup ──
  // inbound_message: find-or-create by contact identity (if no conversationId)
  // task_assignment: always has a conversationId now (Step 4 — Rails creates
  //   the conversation + seeds the first user message on task create/comment)
  const isInbound = job.type === "inbound_message";
  const isTaskAssignment = job.type === "task_assignment";
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

  // Session resume uses SDK's native `options.resume = sessionId`, which
  // loads the transcript from ~/.claude/projects/<dir>/<sessionId>.jsonl and
  // continues. Session rotation (30 turns / 24h) keeps transcripts small so
  // resume is fast. Prompt cache hits on resumed sessions.
  //
  // If resume hangs (large transcript, SDK bug), the RESUME_TIMEOUT_MS below
  // aborts and falls back to a fresh session.
  const RESUME_ENABLED = process.env.RESUME_ENABLED !== "false"; // default true

  // Both inbound_message and task_assignment jobs that have a conversation
  // benefit from session resume — back-and-forth task comments hit the
  // prompt cache the same way user replies on Telegram do.
  const usesConversation = (isInbound || isTaskAssignment) && !!conversation;

  if (usesConversation && conversation) {
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

  // Step 5.5 — if this is a task_assignment with prior checkpoint state, read
  // it so prompt-builder can inject a "Resuming task" block. Lets agents pick
  // up multi-day work from where they left off.
  let taskCheckpoint: Record<string, unknown> | null = null;
  if (isTaskAssignment && job.payload?.taskId) {
    const t = await host.getTask(job.payload.taskId);
    if (t && Object.keys(t.checkpoint).length > 0) taskCheckpoint = t.checkpoint;
  }

  const built = buildPrompt(agent, job, history, conversation, processedMedia, taskCheckpoint);

  const { options, relevantToolkits } = await buildQueryOptions(agent, job, history);
  // System prompt advertises all connected toolkits (not just the routed subset)
  // so the agent knows what's available if it wants to call search_integrations.
  const allConnectedToolkits = await getActiveToolkits(agent.organization_id);
  options.systemPrompt = buildSystemPrompt(agent, skills, allConnectedToolkits);
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  try {
    // SDK handles resume natively. Session rotation keeps transcripts small
    // (30-turn cap), so load times stay reasonable. BullMQ's job lock (10 min)
    // catches pathological hangs.
    const result = await runAgentLoop(built.promptText, options);

    // ── Persist captured session ID for future resumption ──
    // Covers both inbound_message and task_assignment (Step 4) — back-and-forth
    // task comments reuse the same Claude session, hitting the prompt cache.
    if (usesConversation && conversation && result.capturedSessionId) {
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

      // Step 6 — if this is a task conversation, broadcast the new message
      // to the Rails ActionCable TaskChannel so the UI updates in real-time.
      if (isTaskAssignment && job.payload?.taskId && savedMessageId) {
        notifyTaskEvent(job.payload.taskId, savedMessageId).catch(() => {});
      }
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

    // Only emit done for inbound messages — heartbeats and scheduled tasks
    // are background jobs that shouldn't trigger Telegram/channel responses.
    // The [SILENT] prefix lets scheduled/one-off jobs with an instruction
    // suppress the final reply (e.g. "[SILENT] check inbox for urgent items;
    // only notify if something found"). Agent can still use send_email /
    // send_message tools explicitly inside a silent run.
    const isSilent = job.payload?.instruction?.trim().startsWith("[SILENT]") ?? false;
    if (isInbound && !isSilent) {
      emitDone(jobId, finalResponse);
    } else if (isSilent) {
      logger.info(`[SILENT] job ${jobId} — suppressing emitDone (${finalResponse.length} chars)`);
    }

    // Update last_run_at for scheduled tasks (write to both tables during rollout)
    if (job.type === "scheduled_task" && job.payload?.taskId) {
      await host.updateScheduledWorkLastRun(job.payload.taskId).catch(() => {});
      await host.updateScheduledTaskLastRun(job.payload.taskId).catch(() => {});
    }

    // Deliver reminder responses to the original channel
    if (job.payload?.isReminder && finalResponse && job.channel) {
      try {
        const meta = job.payload.metadata || {};
        if (job.channel === "telegram" && meta.bot_token && meta.chat_id) {
          await fetch(`https://api.telegram.org/bot${meta.bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: meta.chat_id, text: finalResponse, parse_mode: "Markdown" }),
          });
          logger.info(`Reminder delivered via Telegram to chat ${meta.chat_id}`);
        }
      } catch (err) {
        logger.error("Failed to deliver reminder", { error: (err as Error).message });
      }
    }

    await host.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: built.promptText.slice(0, 500), taskId: job.payload?.taskId || null, jobId },
      {
        response: finalResponse.slice(0, 2000),
        duration_ms: Date.now() - startTime,
        tool_calls: result.interceptor.capturedToolCalls(),
        session_id: result.capturedSessionId,
      },
      "success",
      {
        routedToolkits: relevantToolkits,
        // Only write a real task FK — scheduled_work IDs also arrive as payload.taskId
        // but they're not in the tasks table, so writing them violates the FK constraint.
        taskId: isTaskAssignment ? (job.payload?.taskId ?? null) : null,
        wasResume: resumeSessionId !== null,
        cacheReadInputTokens: result.cacheReadTokens,
        cacheCreationInputTokens: result.cacheCreationTokens,
      },
    );

    // Log cache hit rate for observability
    if (result.cacheReadTokens > 0 || result.cacheCreationTokens > 0) {
      logger.info(
        `Cache: read=${result.cacheReadTokens}, created=${result.cacheCreationTokens}, resumed=${resumeSessionId !== null}`,
      );
    }

    // Mark task as done on successful completion (unless skipAutoComplete — e.g. reopened task).
    if (isTaskAssignment && job.payload?.taskId && !job.payload?.skipAutoComplete) {
      await host.updateTask(job.payload.taskId, { status: "done", result: { response: finalResponse.slice(0, 10000) } }).catch(() => {});
    }

    // Auto-mirror agent response as a TaskComment so the UI thread always
    // shows the agent's work — but only if the agent didn't already call
    // comment_on_task itself (avoids duplicate comments).
    if (isTaskAssignment && job.payload?.taskId && finalResponse) {
      const alreadyCommented = result.interceptor.capturedToolCalls()
        .some((tc: { name: string }) => tc.name === "mcp__tasks__comment_on_task");
      if (!alreadyCommented) {
        await host.addTaskComment(job.payload.taskId, agent.id, finalResponse).catch(() => {});
      }
    }

    await syncMemoryToDb(agent.id);
    logger.info(`Agent run completed (${finalResponse.length} chars)`);
  } catch (err) {
    emitError(redactSecrets((err as Error).message));
    logger.error(`Agent run failed`, { error: redactSecrets((err as Error).message) });

    // Mark task as failed
    if (job.type === "task_assignment" && job.payload?.taskId) {
      await host.updateTask(job.payload.taskId, { status: "failed" }).catch(() => {});
    }

    await host.saveAuditLog(
      agent.organization_id,
      agent.id,
      job.type,
      undefined,
      { prompt: built.promptText?.slice(0, 500), jobId },
      { error: (err as Error).message },
      "failed",
      {
        routedToolkits: relevantToolkits,
        taskId: isTaskAssignment ? (job.payload?.taskId ?? null) : null,
        wasResume: resumeSessionId !== null,
      },
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
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

async function runAgentLoop(
  promptText: string,
  options: Record<string, unknown>,
): Promise<QueryResult> {
  const interceptor = new ToolInterceptor();
  let responseContent = "";
  let capturedSessionId: string | null = null;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

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

    // Capture usage on the result message (end-of-turn summary)
    if (msg.type === "result" && msg.usage) {
      cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
      cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
    }
  }

  return { responseContent, interceptor, capturedSessionId, cacheReadTokens, cacheCreationTokens };
}

interface BuiltQueryOptions {
  options: Record<string, unknown>;
  relevantToolkits: string[];
}

async function buildQueryOptions(
  agent: Agent,
  job: JobData,
  history: Message[] = [],
): Promise<BuiltQueryOptions> {
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

  // Step 2 — Context-aware tool loading.
  // Route based on current message text + recent conversation context.
  // If the user says "try again" after a Google Sheets conversation, we
  // should keep those tools loaded — not force them to re-mention "sheets".
  const jobText = [
    job.payload?.instruction || "",
    job.payload?.body || "",
    job.payload?.subject || "",
  ].join(" ");
  // Also scan recent history so follow-up messages inherit toolkit context
  const recentContext = history.slice(-5).map((m) => m.content).join(" ");
  const routingText = `${jobText} ${recentContext}`;

  const availableToolkits = await getActiveToolkits(agent.organization_id);
  const toolRouting = process.env.TOOL_ROUTING || "keyword";
  const relevantToolkits = toolRouting === "all"
    ? availableToolkits
    : routeToolkits(routingText, availableToolkits);
  logger.info(
    `Tool routing: ${relevantToolkits.length === 0 ? "search-only" : relevantToolkits.join(", ")} (available: ${availableToolkits.join(", ") || "none"})`,
  );

  const composioResult = await getComposioMcpServer(agent.organization_id, relevantToolkits);
  const composioServer = composioResult?.server;
  const connectedToolkits = composioResult?.toolkits || [];
  const composioToolNames = composioResult?.toolNames || [];

  // Post-V1 #2 — scheduling + task management tools
  const schedulingServer = buildSchedulingMcpServer(agent.id, agent.organization_id, job.channel, job.payload?.metadata);
  const tasksServer = buildTasksMcpServer(agent.id, agent.organization_id);

  const mcpServers: Record<string, unknown> = {
    recall: recallServer,
    "send-media": sendMediaServer,
    scheduling: schedulingServer,
    tasks: tasksServer,
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
      // Composio tools: explicit list (wildcards may not match)
      ...composioToolNames.map((name) => `mcp__composio__${name}`),
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    mcpServers,
    // Phase S — PreToolUse hook for dangerous command detection
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        timeout: 330, // 5.5 min timeout (approval wait is max 5 min)
        hooks: [async (input: any) => {
          const toolInput = input.tool_input as { command?: string } | undefined;
          const command = toolInput?.command || "";

          if (!command) return { hookEventName: "PreToolUse" as const };

          const risk = scanCommand(command, agent.command_allowlist || []);

          if (risk && agent.approval_mode !== "off") {
            logger.warn(`⚠️ Dangerous command detected: ${risk.category} (${risk.level})`, {
              command: command.slice(0, 100),
            });

            // Create a pending approval and send buttons to the user
            const { id, promise } = createCommandApproval(command, risk.category);

            // Send approval request to channel (Telegram buttons, etc.)
            const { emitCommandApproval } = await import("./gateway.js");
            emitCommandApproval({
              approvalId: id,
              command: command.slice(0, 500),
              category: risk.category,
              level: risk.level,
              explanation: risk.explanation,
              suggestedFix: risk.suggestedFix,
            });

            // If on Telegram, send inline buttons
            if (job.channel === "telegram" && job.payload?.metadata?.bot_token && job.payload?.metadata?.chat_id) {
              const { sendWithButtons } = await import("./channels/telegram.js");
              const text =
                `⚠️ *Command Approval Required*\n\n` +
                `\`${command.slice(0, 300)}\`\n\n` +
                `Risk: *${risk.level}* — ${risk.explanation}` +
                (risk.suggestedFix ? `\nSafer: ${risk.suggestedFix}` : "");

              await sendWithButtons(
                job.payload.metadata.bot_token as string,
                job.payload.metadata.chat_id as number,
                text,
                [
                  [
                    { text: "✅ Allow Once", callback_data: `cmd_once_${id}` },
                    { text: "✅ Session", callback_data: `cmd_session_${id}` },
                  ],
                  [
                    { text: "✅ Always", callback_data: `cmd_always_${id}` },
                    { text: "❌ Deny", callback_data: `cmd_deny_${id}` },
                  ],
                ],
              );
            }

            // PAUSE — wait for user's decision (up to 5 min)
            logger.info(`Waiting for command approval ${id}...`);
            const decision = await promise;

            // Record the decision (updates session approvals / DB allowlist)
            await recordApproval(agent, {
              level: decision,
              command,
              risk,
            }, job.conversationId);

            if (decision === "deny") {
              return {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: `Command denied by user: ${risk.explanation}`,
              };
            }

            // Allowed — let it through
            logger.info(`Command approved (${decision}): ${command.slice(0, 80)}`);
            return { hookEventName: "PreToolUse" as const };
          }

          return { hookEventName: "PreToolUse" as const };
        }],
      }],
    },
  };

  if (agent.ai_config?.model_id) {
    options.model = agent.ai_config.model_id;
  }
  if (Object.keys(subAgents).length > 0) {
    options.agents = subAgents;
  }

  return { options, relevantToolkits };
}

// Step 6 — notify Rails to broadcast via ActionCable when a task conversation
// gets a new message. Uses the same engine-secret auth as /api/blobs.
async function notifyTaskEvent(taskId: number, messageId: number): Promise<void> {
  const railsUrl = process.env.RAILS_INTERNAL_URL || "http://localhost:3000";
  const secret = process.env.ENGINE_API_SECRET;
  if (!secret) return;

  await fetch(`${railsUrl}/api/task_events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Engine-Secret": secret,
    },
    body: JSON.stringify({ task_id: taskId, message_id: messageId }),
  });
}
