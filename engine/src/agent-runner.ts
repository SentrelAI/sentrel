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
import { buildApprovalsMcpServer } from "./tools/approvals.js";
import { buildConnectionsMcpServer } from "./tools/connections.js";
import { resolveActionApproval } from "./security/action-approval.js";
import { getComposioMcpServer, getActiveToolkits } from "./integrations/composio.js";
import { buildIntegrationSearchMcpServer, createQueryState, type QueryState } from "./tools/integrations.js";
import { buildKnowledgeMcpServer } from "./tools/knowledge.js";
import { resolveCapabilities } from "./capabilities.js";
import { SpanCollector, computeCostUSD } from "./observability/span-collector.js";
import { scanCommand } from "./security/command-scanner.js";
import { createCommandApproval, type ApprovalLevel } from "./security/command-approval.js";
import { recordApproval } from "./security/approval-interceptor.js";
import { redactSecrets } from "./security/credential-filter.js";
import { ToolInterceptor } from "./tool-interceptor.js";
import { processOutbox } from "./email/outbox-processor.js";
import { maybeHandleApprovalResponse, formatChannelApprovalPreview } from "./email/approval-handler.js";
import {
  broadcast,
  emitThinking,
  emitTextDelta,
  emitToolCall,
  emitToolResult,
  emitDone,
  emitError,
  consumePendingMedia,
} from "./gateway.js";
import { setWhatsAppPendingReply } from "./channels/whatsapp.js";
import { deliverToOrigin } from "./channels/origin-delivery.js";
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
  const spans = new SpanCollector();
  const rootSpan = spans.start("runAgent", { jobType: job.type, agentId: agent.id });

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

  // Always-retrieve RAG (Mem0/Letta pattern): run the user's message
  // through hybrid search, threshold-filter, inject passages into the
  // prompt. No decision, no regex gate — the agent never has to "decide"
  // to call search_knowledge for the common case.
  const knowledgePrefetch = await prefetchKnowledge(agent, job);

  const built = buildPrompt(agent, job, history, conversation, processedMedia, taskCheckpoint, knowledgePrefetch);

  // Shared state so the search_integrations tool can call setMcpServers()
  // to dynamically add Composio toolkits mid-session (same user interaction).
  const queryState = createQueryState();

  const { options, relevantToolkits } = await buildQueryOptions(agent, job, queryState, history);

  // Layer 1: pre-load toolkits the agent used in its last 3 runs — warm start
  // so "try again" doesn't need to re-search. Other toolkits load on-demand.
  queryState.loadedToolkits = new Set(relevantToolkits);
  // System prompt advertises all connected toolkits (not just the routed subset)
  // so the agent knows what's available if it wants to call search_integrations.
  // Item: per-user vs per-org integrations. The originating user's id (from
  // the inbound channel poller / Rails webhook) lets us also load that user's
  // private toolkits — e.g. their personal Gmail — alongside the workspace
  // shared ones. Falls back to org-only when the job has no associated user.
  const originatingUserId = (job.payload?.metadata as Record<string, unknown> | undefined)?.user_id as number | undefined
    ?? (job as { user_id?: number }).user_id;
  const allConnectedToolkits = await getActiveToolkits(agent.organization_id, originatingUserId);
  const teammates = (await host.getTeammates(agent.organization_id, agent.id)).map((t) => ({
    name: t.name, slug: t.slug, role: t.role, managerId: t.manager_id,
  }));
  options.systemPrompt = buildSystemPrompt(agent, skills, allConnectedToolkits, teammates);
  if (resumeSessionId) {
    options.resume = resumeSessionId;
  }

  try {
    // SDK handles resume natively. Session rotation keeps transcripts small
    // (30-turn cap), so load times stay reasonable. BullMQ's job lock (10 min)
    // catches pathological hangs.
    const modelTurnSpan = spans.start("agent_loop", { resumed: !!resumeSessionId });
    let result = await runAgentLoop(built.promptText, options, queryState, spans, jobId);
    spans.end(modelTurnSpan, { response_length: result.responseContent.length });

    // If a resumed run yielded nothing, the session jsonl on disk is gone
    // (Machine was re-provisioned with a fresh volume, DB still had the old
    // session_id pointing at a file that no longer exists). The SDK fails
    // silently in this case — no error, just an empty stream. Retry once
    // without resume so the agent actually produces a response.
    if (resumeSessionId && result.responseContent.length === 0 && usesConversation && conversation) {
      logger.warn(`Resume yielded 0 chars — session ${resumeSessionId} transcript missing; retrying fresh`);
      await host.updateConversationSessionId(conversation.id, null, 0).catch(() => {});
      delete (options as any).resume;
      resumeSessionId = null;
      const retrySpan = spans.start("agent_loop_retry", { reason: "empty_resume" });
      result = await runAgentLoop(built.promptText, options, queryState, spans, jobId);
      spans.end(retrySpan, { response_length: result.responseContent.length });
    }

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

      // Engine inserts via raw SQL, so Message.after_create_commit doesn't
      // fire and the browser would only learn about this row via the `done`
      // event — which gets dropped when no listener is registered (cable
      // dropped, tab closed, engine restart). Always emit a `message` event
      // so AgentChatChannel pushes the row to anyone subscribed, regardless
      // of jobId-listener state.
      try {
        const { broadcast } = await import("./gateway.js");
        broadcast({
          type: "message",
          id: savedMessageId,
          role: "assistant",
          content: result.responseContent,
          created_at: new Date().toISOString(),
          metadata: { conversation_id: conversationId },
          timestamp: Date.now(),
        });
      } catch (err) {
        logger.warn("Failed to broadcast message event", { error: (err as Error).message });
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

    // Update last_run_at on the scheduled_work row.
    if (job.type === "scheduled_task" && job.payload?.taskId) {
      await host.updateScheduledWorkLastRun(job.payload.taskId).catch(() => {});
    }

    // Scheduled tasks deliver their final text to the originating channel —
    // the one captured when the schedule was created (via chat → that chat's
    // channel; via UI → the dropdown value, default "web"). [SILENT] tasks
    // stay audit-only. For "web", we persist to the agent's internal chat
    // conversation so the user sees it on next visit / via ActionCable.
    if (job.type === "scheduled_task" && !isSilent && finalResponse && job.channel) {
      await deliverScheduledResponse(agent, job, finalResponse).catch((err) => {
        logger.error("Failed to deliver scheduled task response", { error: (err as Error).message, channel: job.channel });
      });
    }

    spans.end(rootSpan, { status: "success" });
    spans.finalize();
    const modelId = agent.ai_config?.model_id || null;
    const totalCost = computeCostUSD(
      modelId,
      result.inputTokens,
      result.outputTokens,
      result.cacheReadTokens,
      result.cacheCreationTokens,
    );

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
        spans: spans.serialize(),
        totalCostUsd: totalCost,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - startTime,
        firstTokenMs: spans.firstTokenMs(),
        modelId,
        jobId,
        conversationIdRef: conversation?.id?.toString() || null,
        activeCapabilities: resolveCapabilities(agent) as unknown as Record<string, unknown>,
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

    // Cross-agent report-back: if another agent assigned this task, push a
    // follow-up into THEIR inbox summarizing the result. Assigner gets woken
    // immediately instead of discovering completion on next poll. Origin is
    // forwarded so when the assigner finishes processing, the engine can
    // auto-deliver back to the user's original channel (Telegram chat, etc.).
    if (isTaskAssignment && job.payload?.taskId && finalResponse) {
      try {
        const task = await host.getTask(job.payload.taskId);
        if (task?.assigned_by_agent_id && task.assigned_by_agent_id !== agent.id) {
          const summary = finalResponse.slice(0, 1500);
          await host.publishInboundToAgent(task.assigned_by_agent_id, {
            type: "task_assignment",
            jobId: `task-reportback-${task.id}`,
            orgId: agent.organization_id,
            origin: job.origin,
            payload: {
              taskId: task.id,
              instruction: `Task completed by ${agent.name} (${agent.role}): "${task.title}"\n\nResult:\n${summary}\n\nThis is a report-back on work you delegated. Decide if anything else needs to happen on your end (do it or delegate further). The user who originally requested this will be notified automatically — your final response to this prompt will be delivered to them as the status update, so write it directly to the user.`,
              skipAutoComplete: true,
            },
          });
          logger.info(`Report-back queued for assigner agent ${task.assigned_by_agent_id} (task ${task.id})`);
        }
      } catch (err) {
        logger.warn("Cross-agent report-back failed", { error: (err as Error).message });
      }
    }

    // Origin auto-delivery: a "task-reportback-*" jobId means the engine just
    // told this agent "your downstream report is in" — their response on this
    // run IS the user-facing status update. Deliver it straight to the origin
    // channel that started the delegation chain so the user hears back without
    // anyone needing to call a send_* tool. Inbound messages keep using their
    // existing native listener path; only synthetic report-back jobs need this.
    if (isTaskAssignment && finalResponse && !isSilent && job.origin?.channel && job.jobId?.startsWith("task-reportback-")) {
      await deliverToOrigin(job.origin, finalResponse).catch((err) => {
        logger.warn("Origin auto-delivery failed", { error: (err as Error).message, channel: job.origin?.channel });
      });
    }

    await syncMemoryToDb(agent.id);
    logger.info(`Agent run completed (${finalResponse.length} chars)`);
  } catch (err) {
    spans.event("error", { message: (err as Error).message });
    spans.end(rootSpan, { status: "failed" });
    spans.finalize();
    const errMsg = redactSecrets((err as Error).message);
    logger.error(`Agent run failed`, { error: errMsg });

    // 429 / rate-limit retry: the SDK gives up after a few internal retries
    // when the provider returns 429 (OpenRouter / Anthropic / OpenAI all do
    // this under load). Instead of failing the task, re-enqueue the same job
    // for ~90 seconds later so the agent gets another shot once the bucket
    // refills. Cap at 3 retries to avoid infinite loops on a hard rate cap.
    const isRateLimit = /\b429\b|rate.?limit/i.test(errMsg);
    const retryCount = (job as JobData & { _retryCount?: number })._retryCount ?? 0;
    if (isRateLimit && retryCount < 3) {
      const delaySec = 60 + retryCount * 60; // 60s, 120s, 180s
      logger.warn(`Rate-limited (attempt ${retryCount + 1}/3); re-enqueueing job in ${delaySec}s`, { jobId });
      const retryPayload = { ...job, _retryCount: retryCount + 1, jobId: `${jobId}-retry${retryCount + 1}` };
      const { redis } = await import("./queue.js");
      setTimeout(() => {
        redis.lpush(`agent-inbox-${agent.id}`, JSON.stringify(retryPayload)).catch(() => {});
      }, delaySec * 1000).unref();
      // Leave task in_progress so the kanban shows the work is still
      // happening rather than failed.
      if (job.type === "task_assignment" && job.payload?.taskId) {
        await host.updateTask(job.payload.taskId, { status: "in_progress" }).catch(() => {});
      }
      // Tell the user channel this is happening, but don't error-emit.
      if (job.origin?.channel) {
        await deliverToOrigin(job.origin, `⏳ Hit a ${isRateLimit ? "rate limit" : "transient error"} on this turn — retrying in ${delaySec}s.`).catch(() => {});
      }
      return; // skip the failed-status / error emit below
    }

    emitError(errMsg);

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
        spans: spans.serialize(),
        durationMs: Date.now() - startTime,
        jobId,
        conversationIdRef: conversation?.id?.toString() || null,
        activeCapabilities: resolveCapabilities(agent) as unknown as Record<string, unknown>,
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
  inputTokens: number;
  outputTokens: number;
}

async function runAgentLoop(
  promptText: string,
  options: Record<string, unknown>,
  queryState: QueryState,
  spans: SpanCollector | undefined,
  jobId: string,
): Promise<QueryResult> {
  const interceptor = new ToolInterceptor();
  let responseContent = "";
  let capturedSessionId: string | null = null;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  emitThinking();

  // Streaming input mode. Returns a Query handle we stash in queryState so
  // the search_integrations tool handler can call setMcpServers() to load
  // new toolkits dynamically during the run (same user interaction).
  //
  // The async generator must stay open until the query finishes — otherwise
  // the SDK closes the control channel and setMcpServers() won't work.
  let closeInputStream: (() => void) | null = null;
  async function* userMessageStream() {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: promptText },
      parent_tool_use_id: null,
      session_id: "",
    };
    await new Promise<void>((resolve) => { closeInputStream = resolve; });
  }

  const q = query({ prompt: userMessageStream(), options: options as any });
  queryState.current = q;

  // Track open tool_use spans so we can close them when matching tool_result arrives
  const toolUseSpans = new Map<string, number>();

  for await (const message of q) {
    const msg = message as any;

    // Capture sessionId from the first message that has one (per sdk.d.ts:2467+,
    // every SDKMessage has session_id, and the first is always SDKSystemMessage
    // with subtype: "init" containing it)
    if (!capturedSessionId && msg.session_id) {
      capturedSessionId = msg.session_id;
    }

    // Log which tools the agent has on init (for debugging tool loading)
    if (msg.type === "system" && msg.subtype === "init" && msg.tools) {
      const toolNames = Array.isArray(msg.tools) ? msg.tools : Object.keys(msg.tools || {});
      const composioTools = toolNames.filter((t: string) => t.startsWith("mcp__composio__"));
      const mcpTools = toolNames.filter((t: string) => t.startsWith("mcp__") && !t.startsWith("mcp__composio__"));
      const hasKnowledge = toolNames.includes("mcp__knowledge__search_knowledge");
      logger.info(`SDK init: ${composioTools.length} Composio, ${mcpTools.length} other MCP, knowledge=${hasKnowledge ? "yes" : "NO"}`);
      if (!hasKnowledge) {
        logger.warn(`search_knowledge NOT in allowedTools! MCP tools seen: ${mcpTools.join(", ")}`);
      }
    }

    if (msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) {
          responseContent = block.text;
          emitTextDelta(jobId, block.text);
          spans?.event("text_block", { length: block.text.length });
        }
        if (block.type === "tool_use") {
          emitToolCall(jobId, block.name, block.input);
          interceptor.observe(block);
          // Start a span for the tool call — duration = time until tool_result comes back
          if (spans && block.id) {
            const spanId = spans.start(`tool_use:${block.name}`, {
              tool_name: block.name,
              input_preview: JSON.stringify(block.input || {}).slice(0, 200),
            });
            toolUseSpans.set(block.id, spanId);
          }
        }
        if (block.type === "tool_result") {
          const content = typeof block.content === "string" ? block.content : "done";
          emitToolResult(block.name || "tool", content);
          // Close the matching tool_use span
          if (spans && block.tool_use_id) {
            const spanId = toolUseSpans.get(block.tool_use_id);
            if (spanId != null) {
              spans.end(spanId, {
                result_length: typeof block.content === "string" ? block.content.length : 0,
              });
              toolUseSpans.delete(block.tool_use_id);
            }
          }
        }
      }
    }

    if (msg.result) {
      responseContent = msg.result;
    }

    // SDK progress events — human-readable summaries of what the agent is doing
    if (msg.type === "system" && msg.subtype === "task_progress" && msg.summary) {
      logger.info(`Progress: ${msg.summary}`);
      broadcast({ type: "progress_summary", summary: msg.summary, timestamp: Date.now() });
    }
    if (msg.type === "tool_use_summary" && msg.summary) {
      logger.info(`Tool summary: ${msg.summary}`);
      broadcast({ type: "progress_summary", summary: msg.summary, timestamp: Date.now() });
    }
    if (msg.type === "system" && msg.subtype === "task_notification") {
      logger.info(`Task notification: ${msg.summary || msg.status}`);
    }

    // Capture usage on the result message (end-of-turn summary)
    if (msg.type === "result") {
      if (msg.usage) {
        cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
        cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
        inputTokens = msg.usage.input_tokens || 0;
        outputTokens = msg.usage.output_tokens || 0;
      }
      // Streaming input mode: the for-await loop doesn't exit on its own —
      // the SDK expects more user messages. Close the input stream on result
      // so the SDK can end the query cleanly.
      if (closeInputStream) {
        (closeInputStream as () => void)();
        closeInputStream = null;
      }
      try { await q.close(); } catch {}
      break;
    }
  }

  // Belt-and-suspenders: close input stream if we exited the loop some other way
  if (closeInputStream) (closeInputStream as () => void)();
  queryState.current = null;

  return { responseContent, interceptor, capturedSessionId, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens };
}

interface BuiltQueryOptions {
  options: Record<string, unknown>;
  relevantToolkits: string[];
}

async function buildQueryOptions(
  agent: Agent,
  job: JobData,
  queryState: QueryState,
  history: Message[] = [],
): Promise<BuiltQueryOptions> {
  const subAgents = await buildSubAgentDefinitions(agent);

  if (config.anthropicBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl;
  }

  // Capability-gated MCP server registration. Agents only pay for tools
  // they have enabled. See `capabilities.ts` for defaults.
  const caps = resolveCapabilities(agent);
  const mcpServers: Record<string, unknown> = {};
  const baseMcpServers: Record<string, unknown> = {};

  if (caps.recall.enabled) {
    const recallServer = buildRecallMcpServer(agent.organization_id);
    mcpServers.recall = recallServer;
    baseMcpServers.recall = recallServer;
  }

  if (caps.send_media.enabled) {
    // Read bot number from channel config so WhatsApp From number is correct
    const channelConfigs = await host.getChannelConfigs(String(agent.id));
    const waConfig = channelConfigs.find((c) => c.channel_type === "whatsapp");
    const channelMeta = {
      ...(job.payload?.metadata || {}),
      from: job.payload?.from,
      bot_number: waConfig?.config?.phone_number || process.env.WHATSAPP_BOT_NUMBER || "",
    };
    const sendMediaServer = buildSendMediaMcpServer(job.channel || "web", channelMeta);
    mcpServers["send-media"] = sendMediaServer;
    baseMcpServers["send-media"] = sendMediaServer;
  }

  if (caps.scheduling.enabled) {
    const schedulingServer = buildSchedulingMcpServer(agent.id, agent.organization_id, job.channel, job.payload?.metadata);
    mcpServers.scheduling = schedulingServer;
    baseMcpServers.scheduling = schedulingServer;
  }

  // Compute the origin context once — used by both the tasks/approvals MCPs
  // (for cross-agent delegation + report-back routing) and the connections
  // MCP (for persisting Connect cards with origin so they reach the right
  // channel after refresh).
  const taskOrigin = job.origin
    ? job.origin
    : job.channel
      ? { channel: job.channel, metadata: job.payload?.metadata || {}, conversationId: job.conversationId ?? null }
      : undefined;

  if (caps.tasks.enabled) {
    const tasksServer = buildTasksMcpServer(agent.id, agent.organization_id, taskOrigin, job.payload?.taskId);
    mcpServers.tasks = tasksServer;
    baseMcpServers.tasks = tasksServer;

    // Item 4 — generic approval tool (request_approval). Lives next to tasks
    // because it shares the same origin propagation: the user's channel needs
    // to receive the approval card.
    const approvalsServer = buildApprovalsMcpServer({
      agentId: agent.id,
      orgId: agent.organization_id,
      origin: taskOrigin,
    });
    mcpServers.approvals = approvalsServer;
    baseMcpServers.approvals = approvalsServer;
  }

  if (caps.knowledge_base.enabled) {
    const knowledgeServer = buildKnowledgeMcpServer(agent.id, agent.organization_id);
    mcpServers.knowledge = knowledgeServer;
    baseMcpServers.knowledge = knowledgeServer;
  }

  // Integrations capability gates both `integrations` (search) and
  // `composio` (actual execution tools). Disable the capability to
  // produce a pure-knowledge/internal agent with no external tool access.
  let connectedToolkits: string[] = [];
  let composioToolNames: string[] = [];
  let relevantToolkits: string[] = [];
  if (caps.integrations.enabled) {
    const integrationsServer = buildIntegrationSearchMcpServer(agent.organization_id, queryState);
    mcpServers.integrations = integrationsServer;
    baseMcpServers.integrations = integrationsServer;

    // Item 5 — propose_connection. Lives next to integrations: same gating
    // (a no-integrations agent doesn't need it), same purpose (let the agent
    // ask the user to connect a service). Posts an inline "Connect <X>" card
    // AND persists it via pending_approvals so the card survives a refresh.
    const connectionsServer = buildConnectionsMcpServer({
      agentId: agent.id,
      orgId: agent.organization_id,
      origin: taskOrigin,
    });
    mcpServers.connections = connectionsServer;
    baseMcpServers.connections = connectionsServer;

    // Step 2 — Context-aware tool loading (hybrid: pre-load + on-demand).
    // Layer 1 (pre-query): Audit log tool history — keep toolkits the agent
    //   used recently (handles "try again").
    // Layer 2 (pre-query): Embedding match on user message — pre-load
    //   toolkits the user is clearly asking for. Agent has tools from turn 1.
    // Layer 3 (on-demand): search_integrations MCP tool — agent calls it to
    //   load ADDITIONAL toolkits mid-session if needed.
    // Layer 4 (fallback): COMPOSIO_SEARCH_TOOLS (Composio API).
    const buildOriginatingUserId = (job.payload?.metadata as Record<string, unknown> | undefined)?.user_id as number | undefined
      ?? (job as { user_id?: number }).user_id;
    const availableToolkits = await getActiveToolkits(agent.organization_id, buildOriginatingUserId);
    const toolRouting = process.env.TOOL_ROUTING || "smart";

    const layer1 = await getRecentComposioToolkits(agent.id);

    const routingText = [
      job.payload?.instruction || "",
      job.payload?.body || "",
      job.payload?.subject || "",
      ...history.slice(-2).map((m) => m.content),
    ].join(" ");
    const { searchToolkits, isEmbeddingReady } = await import("./integrations/tool-embeddings.js");
    const layer2 = isEmbeddingReady() ? await searchToolkits(routingText, availableToolkits, 3, 0.3) : [];

    // Layer 0 — brand-name nudge. If the user spelled out a connected toolkit
    // slug/label in plain text ("...add to Apollo", "push to HubSpot"), force-
    // include it. This fires regardless of embedding readiness, which means
    // cold-boot sessions still get the right toolkit pre-loaded instead of
    // hallucinating about non-existent API keys.
    const lowerRoutingText = routingText.toLowerCase();
    const layer0 = availableToolkits.filter((slug) => {
      const slugLower = slug.toLowerCase();
      // Match either the slug ("apollo", "googlesheets") or a humanised form
      // ("google sheets"). Single-word slugs need a wordish boundary so we
      // don't trigger on substrings ("notion" inside "notional").
      if (new RegExp(`\\b${slugLower}\\b`).test(lowerRoutingText)) return true;
      const spaced = slugLower.replace(/(google|micro|smart|hub|sales|click)([a-z]+)/, "$1 $2");
      return spaced !== slugLower && lowerRoutingText.includes(spaced);
    });

    relevantToolkits = toolRouting === "all"
      ? availableToolkits
      : [...new Set([...layer0, ...layer1, ...layer2])].filter((t) => availableToolkits.includes(t));

    logger.info(
      `Tool routing: ${relevantToolkits.length === 0 ? "search-only" : relevantToolkits.join(", ")} ` +
      `(layer0=${layer0.join(",") || "-"}, layer1=${layer1.join(",") || "-"}, layer2=${layer2.join(",") || "-"}, available: ${availableToolkits.join(", ") || "none"})`,
    );

    // Per-agent ACL — engine drops Composio tools the policy rejects before
    // the agent ever sees them. Empty array (no rows) = default policy
    // (allow everything common), preserving back-compat.
    const toolPolicies = await host.getAgentToolPolicies(agent.id);
    const composioResult = await getComposioMcpServer(agent.organization_id, relevantToolkits, buildOriginatingUserId, toolPolicies);
    const composioServer = composioResult?.server;
    connectedToolkits = composioResult?.toolkits || [];
    composioToolNames = composioResult?.toolNames || [];

    if (composioServer) {
      mcpServers.composio = composioServer;
      // Note: composio is NOT in baseMcpServers — search_integrations
      // swaps composio servers via setMcpServers, but keeps the base set intact.
    }
  } else {
    logger.info(`Tool routing: integrations capability disabled — no composio/integrations MCP servers`);
  }

  // Store base (non-composio) servers so search_integrations can include
  // them in its setMcpServers call — otherwise setMcpServers would nuke them.
  queryState.baseMcpServers = baseMcpServers;

  logger.info(`MCP servers registered: ${Object.keys(mcpServers).join(", ") || "none"}`);

  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    // SDK isolation — don't load the user's ~/.claude/settings.json (which
    // brings in personal MCP servers like Linear/Sentry/Gmail and pollutes
    // the agent's tool list with 60+ unrelated tools).
    settingSources: [],
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
      // Capability-gated MCP tools — only listed when their server is registered
      ...(caps.recall.enabled ? [
        "mcp__recall__search_messages",
        "mcp__recall__search_activity",
      ] : []),
      ...(caps.send_media.enabled ? [
        "mcp__send-media__send_voice",
        "mcp__send-media__send_image",
        "mcp__send-media__send_file",
      ] : []),
      ...(caps.integrations.enabled ? [
        "mcp__integrations__search_integrations",
        // Composio tools: explicit list (wildcards may not match)
        ...composioToolNames.map((name) => `mcp__composio__${name}`),
      ] : []),
      ...(caps.knowledge_base.enabled ? [
        "mcp__knowledge__search_knowledge",
        "mcp__knowledge__share_to_org",
      ] : []),
      ...(caps.scheduling.enabled ? [
        "mcp__scheduling__schedule_task",
        "mcp__scheduling__set_reminder",
        "mcp__scheduling__list_schedules",
        "mcp__scheduling__delete_schedule",
      ] : []),
      ...(caps.tasks.enabled ? [
        "mcp__tasks__create_task",
        "mcp__tasks__list_tasks",
        "mcp__tasks__update_task",
        "mcp__tasks__comment_on_task",
        "mcp__tasks__write_checkpoint",
        "mcp__tasks__ask_user",
        "mcp__tasks__cancel_self",
      ] : []),
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    agentProgressSummaries: true,
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

  // For OpenRouter, the model is resolved via ANTHROPIC_DEFAULT_*_MODEL env
  // vars (set by Rails agent_provisioner) — the SDK would reject non-Claude
  // slugs like "moonshotai/kimi-k2.6" if passed here directly.
  if (agent.ai_config?.provider === "openrouter") {
    // Stays unset; SDK uses its default tier -> env var -> OR slug.
  } else if (agent.ai_config?.model_id) {
    options.model = agent.ai_config.model_id;
  }
  if (Object.keys(subAgents).length > 0) {
    options.agents = subAgents;
  }

  return { options, relevantToolkits };
}

// Scheduled-task channel delivery. Fires after a non-silent scheduled job
// completes, forwarding the agent's final text to the channel stored on the
// schedule's payload_extra (set by the scheduling tool or UI dropdown).
//
// - telegram: direct Bot API sendMessage using bot_token + chat_id in metadata.
// - whatsapp: Twilio outbound SMS/WhatsApp via host helper.
// - web:      persists a message to the agent's internal conversation for the
//             assigned user so the Inertia chat tab renders it on next visit,
//             plus notifies Rails so ActionCable can push it live.
async function deliverScheduledResponse(agent: Agent, job: JobData, content: string): Promise<void> {
  const meta = (job.payload?.metadata || {}) as Record<string, unknown>;
  const channel = job.channel;

  if (channel === "telegram") {
    const botToken = meta.bot_token as string | undefined;
    const chatId = meta.chat_id as string | number | undefined;
    if (!botToken || !chatId) {
      logger.warn("Scheduled delivery: telegram channel missing bot_token or chat_id");
      return;
    }
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: content, parse_mode: "Markdown" }),
    });
    logger.info(`Scheduled delivery: sent to Telegram chat ${chatId} (${content.length} chars)`);
    return;
  }

  if (channel === "whatsapp") {
    const from = meta.from as string | undefined;
    if (!from) {
      logger.warn("Scheduled delivery: whatsapp channel missing `from` metadata");
      return;
    }
    const { sendMessage } = await import("./channels/whatsapp.js");
    await sendMessage(from, content);
    logger.info(`Scheduled delivery: sent to WhatsApp ${from} (${content.length} chars)`);
    return;
  }

  if (channel === "web") {
    // Persist into the agent's internal conversation so the Inertia chat tab
    // renders it on next load. Picks the most recently active internal conv
    // — matches the picker in agents_controller#show.
    const conv = await host.getInternalConversation(agent.id);
    if (!conv) {
      logger.warn("Scheduled delivery: web channel has no internal conversation yet");
      return;
    }
    const msg = await host.saveMessage(
      conv.id,
      "assistant",
      content,
      "outbound",
      "web",
      [],
      { source: "scheduled_task", scheduled_work_id: job.payload?.taskId ?? null },
    );
    logger.info(`Scheduled delivery: saved message ${msg.id} to internal conversation ${conv.id}`);
    return;
  }

  logger.warn(`Scheduled delivery: unsupported channel "${channel}" — message dropped`);
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

// Layer 1 of tool routing: extract toolkit slugs from the agent's most recent
// audit log entry. If the agent used mcp__composio__GOOGLESHEETS_* last turn,
// keep googlesheets loaded without the user needing to re-mention it.
async function getRecentComposioToolkits(agentId: number): Promise<string[]> {
  try {
    const logs = await host.getRecentAuditToolCalls(agentId, 3);
    const toolkits = new Set<string>();
    for (const toolName of logs) {
      const match = toolName.match(/^mcp__composio__([A-Z]+?)_/);
      if (match && match[1]) {
        toolkits.add(match[1].toLowerCase());
      }
    }
    return [...toolkits];
  } catch {
    return [];
  }
}

// Always-retrieve RAG with threshold filter (Mem0/Letta pattern).
// Runs on every inbound turn when knowledge_base is enabled. No regex, no
// "decide whether to search" — embed the user text, run hybrid search,
// keep only passages above the similarity threshold, inject into the prompt.
async function prefetchKnowledge(agent: Agent, job: JobData) {
  const caps = resolveCapabilities(agent);
  if (!caps.knowledge_base.enabled) return null;
  if (!caps.knowledge_base.always_retrieve) return null;
  if (job.type !== "inbound_message" && job.type !== "task_assignment") return null;

  const userText = job.payload?.body || job.payload?.instruction || "";
  if (!userText.trim()) return null;

  const topK = caps.knowledge_base.top_k ?? 5;
  const agentThreshold = caps.knowledge_base.threshold ?? 0.75;

  try {
    const { listDocuments, searchMerged, agentScope, orgScope } = await import("./rag/store.js");
    const { embedText, isEmbeddingReady } = await import("./integrations/tool-embeddings.js");
    if (!isEmbeddingReady()) return null;
    // Fast exit: skip if neither the agent nor the org has any docs indexed.
    const [agentDocs, orgDocs] = await Promise.all([
      listDocuments(agentScope(agent.id)).catch(() => []),
      listDocuments(orgScope(agent.organization_id)).catch(() => []),
    ]);
    if (agentDocs.length === 0 && orgDocs.length === 0) return null;

    const embedding = await embedText(userText);
    if (!embedding) return null;

    const raw = await searchMerged(agent.organization_id, agent.id, embedding, userText, topK);
    // Per-doc threshold override: a document can set metadata.threshold
    // (0..1 cosine similarity) to be more permissive (low-bar match — good
    // for catch-all reference docs) or stricter (high-precision — good for
    // contracts/policies where a wrong match is costly). Falls back to the
    // agent-level threshold when absent.
    const filtered = raw.filter((r) => {
      const docThreshold = typeof r.document_metadata?.threshold === "number"
        ? (r.document_metadata.threshold as number)
        : agentThreshold;
      return r.distance <= (1 - docThreshold);
    });
    if (filtered.length === 0) {
      logger.info(`Knowledge prefetch: "${userText.slice(0, 60)}" → 0/${raw.length} above threshold (agent default ${agentThreshold})`);
      return null;
    }

    logger.info(`Knowledge prefetch: "${userText.slice(0, 60)}" → ${filtered.length}/${raw.length} passages above threshold (agent default ${agentThreshold})`);

    return {
      query: userText.slice(0, 200),
      passages: filtered.map((r) => ({
        document_title: r.document_title,
        chunk_index: r.chunk_index,
        content: r.content,
        context: r.context,
        distance: r.distance,
      })),
    };
  } catch (err) {
    logger.warn("Knowledge prefetch failed", { error: (err as Error).message });
    return null;
  }
}
