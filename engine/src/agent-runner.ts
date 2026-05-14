import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { config } from "./config.js";
import { host } from "./host/index.js";
import { syncMemoryToDb } from "./memory.js";
import { buildSubAgentDefinitions } from "./subagents.js";
import { buildPrompt } from "./prompt-builder.js";
import { summarizeConversation } from "./summarizer.js";
import { consolidateAtRotation } from "./memory-consolidation.js";
import { decideRotation, contextWindowFor, DEFAULT_ROTATION } from "./session-rotation.js";
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
import { buildSecretsMcpServer } from "./tools/secrets.js";
import { buildSkillsCreatorMcpServer } from "./tools/skills-create.js";
import { createSlackChannelMcpServer } from "./tools/slack-channel.js";
import { detectIntegrationIntents, hasIntegrationIntent, routeIntegrationRequest, toolkitsForIntent } from "./integrations/intent-router.js";
import { resolveCapabilities } from "./capabilities.js";
import { SpanCollector, computeCostUSD } from "./observability/span-collector.js";
import { scanCommand } from "./security/command-scanner.js";
import { createCommandApproval, type ApprovalLevel } from "./security/command-approval.js";
import { recordApproval } from "./security/approval-interceptor.js";
import { redactSecrets } from "./security/credential-filter.js";
import { ToolInterceptor } from "./tool-interceptor.js";
import { checkSpendCap, markSpendNotified } from "./spend-caps.js";
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
  emitThinkingDelta,
  consumePendingMedia,
  getToolLabel,
} from "./gateway.js";
import { setWhatsAppPendingReply } from "./channels/whatsapp.js";
import { deliverToOrigin } from "./channels/origin-delivery.js";
import type { Agent, Conversation, JobData, Message } from "./types.js";
import { logger } from "./logger.js";
import { getCachedSystemPrompt } from "./runtime/system-prompt-cache.js";
import { createSdkQuery } from "./runtime/warm-query-pool.js";
import { runLockKey, withConversationRunLock } from "./runtime/conversation-locks.js";

// Item 8 (rotation rebuild) — session rotation now uses Hermes/OpenClaw-style
// token-utilization triggers. The old turn-count cap is kept as a hard fail-
// safe at 200 (≫ typical conversation length) so a runaway loop can't bypass
// rotation entirely. See session-rotation.ts for the actual policy.
const SESSION_TURN_HARD_CAP = 200;

// Top-level orchestrator: routes a job to the right handler and runs the
// Claude Agent SDK loop. Heavy lifting (prompt, outbox, approvals, summarization)
// lives in dedicated modules.
export async function runAgent(agent: Agent, job: JobData): Promise<void> {
  return withConversationRunLock(runLockKey(job), job.jobId, () => runAgentUnlocked(agent, job));
}

async function runAgentUnlocked(agent: Agent, job: JobData): Promise<void> {
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

  // ── Task cancellation: short-circuit. Rails publishes this when the user
  // hits Cancel on a task; the engine just acknowledges in logs and exits.
  // The agent_loop running in another worker will see status=cancelled in DB
  // on its next polled state read and stop on its own.
  if (job.type === "task_cancelled") {
    const ids: number[] = (job.payload as { taskIds?: number[] } | undefined)?.taskIds || [];
    const root = (job.payload as { rootTaskId?: number } | undefined)?.rootTaskId;
    logger.info(`Task cancelled signal: agent=${agent.id} root=${root} affected=${ids.join(",")}`);
    await host.saveAuditLog(
      agent.organization_id, agent.id, "task_cancelled", undefined,
      { rootTaskId: root, taskIds: ids }, { response: "ack" }, "success",
    ).catch(() => {});
    return;
  }

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
  const isReportbackJob = isTaskAssignment && job.jobId?.startsWith("task-reportback-") === true;

  // Spend-cap enforcement. Rails owns the cap config + spend rollup; the
  // engine asks via /api/spend_caps/check before each run. Hard-stop on
  // over-cap, soft "approaching cap" notify when crossing the threshold.
  // Best-effort — network failure / missing cap doesn't block the run.
  const cap = await checkSpendCap(agent.id).catch(() => null);
  if (cap?.over_daily || cap?.over_monthly) {
    const which = cap.over_daily ? "daily" : "monthly";
    const spent = cap.over_daily ? cap.spend_today_usd : cap.spend_month_usd;
    const limit = cap.over_daily ? cap.daily_cap_usd : cap.monthly_cap_usd;
    logger.warn(`Spend cap hit (${which}) for agent ${agent.id}: $${spent} / $${limit}`);
    emitError(`⚠️ Spend cap hit: $${spent?.toFixed(2)} / $${limit?.toFixed(2)} ${which}.`);
    if (job.type === "inbound_message" && job.conversationId) {
      await host
        .saveMessage(
          job.conversationId,
          "assistant",
          `⚠️ Spend cap hit: $${spent?.toFixed(2)} of $${limit?.toFixed(2)} ${which} budget. The agent will resume after the cap rolls over (or after you raise the cap on the agent's edit page).`,
          "outbound",
          job.channel || "web",
          undefined,
          { spend_cap_hit: true },
        )
        .catch((e) => logger.warn("Failed to persist spend-cap message", { error: (e as Error).message }));
    }
    return;
  }
  if (cap?.should_notify) {
    const pct = Math.round((cap.spend_today_usd / cap.daily_cap_usd!) * 100);
    if (job.type === "inbound_message" && job.conversationId) {
      await host
        .saveMessage(
          job.conversationId,
          "assistant",
          `ℹ️ Approaching daily spend cap — $${cap.spend_today_usd.toFixed(2)} of $${cap.daily_cap_usd!.toFixed(2)} (${pct}%). I'll keep going, but heads-up.`,
          "outbound",
          job.channel || "web",
          undefined,
          { spend_cap_notify: true },
        )
        .catch(() => {});
      await markSpendNotified(agent.id).catch(() => {});
    }
  }

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
    // Item 8 — token-utilization-based rotation (Hermes-style threshold +
    // OpenClaw-style hygiene cap). Pull the most recent run's actual input
    // tokens for an accurate "how full is this session" signal.
    const lastRun = await host.getMostRecentAuditLog?.(agent.id, conversation.id) ?? null;
    const lastRunPromptTokens = lastRun
      ? [
          lastRun.input_tokens,
          lastRun.cache_read_input_tokens,
          lastRun.cache_creation_input_tokens,
        ].reduce<number>((sum, value) => sum + (Number(value) || 0), 0)
      : 0;
    const messagesForRotation = await host.getConversationHistory(conversation.id, 500);
    const totalCharsFallback = messagesForRotation.reduce((s, m) => s + (m.content?.length || 0), 0);
    const decision = decideRotation(agent, {
      hasSessionId: !!conversation.claude_session_id,
      lastMessageAt: conversation.last_message_at ?? null,
      messageCount: messagesForRotation.length,
      lastRunInputTokens: lastRunPromptTokens > 0 ? lastRunPromptTokens : null,
      totalCharsFallback,
    });
    const stillUnderHardCap = (conversation.claude_session_turn_count ?? 0) < SESSION_TURN_HARD_CAP;

    if (decision.resume && stillUnderHardCap) {
      priorTurnCount = conversation.claude_session_turn_count ?? 0;
      if (RESUME_ENABLED) {
        resumeSessionId = conversation.claude_session_id ?? null;
        const pct = decision.details.thresholdTokens
          ? Math.round((decision.details.estimatedTokens / decision.details.thresholdTokens) * 100)
          : 0;
        logger.info(
          `Resuming session for conversation ${conversation.id} (turn ${priorTurnCount + 1}, ` +
          `~${decision.details.estimatedTokens.toLocaleString()} tok / ${decision.details.thresholdTokens.toLocaleString()} threshold = ${pct}%)`
        );
      }
    } else if (conversation.claude_session_id) {
      const reason = !stillUnderHardCap ? "turn-hard-cap" : decision.reason;
      logger.info(
        `Rotating session for conversation ${conversation.id} (reason: ${reason}, ` +
        `tokens ~${decision.details.estimatedTokens.toLocaleString()}/${decision.details.thresholdTokens.toLocaleString()}, ` +
        `messages=${decision.details.messageCount}, context_window=${decision.details.contextTokens.toLocaleString()})`
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

      // Item 8 — also extract durable facts and fold them into MEMORY.md.
      // summarizeConversation gives us a per-conversation_summaries snapshot
      // (visible to the engine on the next resume); consolidateAtRotation
      // compresses to the cross-conversation MEMORY.md the agent reads on
      // every turn, with a DREAMS.md audit trail for human review.
      try {
        const messages = await host.getConversationHistory(conversation.id, 100);
        const turnRange = `1-${conversation.claude_session_turn_count ?? 0}`;
        const updatedMemory = await consolidateAtRotation(agent, messages, turnRange);
        if (updatedMemory) {
          await host.updateAgentMemory(agent.id, updatedMemory).catch(() => {});
        }
      } catch (err) {
        logger.warn("Memory consolidation during rotation failed", { error: (err as Error).message });
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
  const skillsSpan = spans.start("sync_skills");
  const skills = await syncSkillsFromDb(agent.id);
  spans.end(skillsSpan, { count: skills.length });

  // ── Sprint 2: process media attachments (transcribe audio, save files) ──
  // Prefer the URL-resolved `attachments` array (presigned S3 URLs from the
  // webhook — engine fetches directly, no Rails round-trip). Fall back to
  // bare signed_ids for legacy jobs / channels that haven't been migrated.
  const attachmentInputs = job.payload?.attachments?.length
    ? job.payload.attachments
    : (job.payload?.attachment_ids || []);
  const mediaSpan = spans.start("process_attachments", { count: attachmentInputs.length });
  const processedMedia = attachmentInputs.length > 0
    ? await processAttachments(attachmentInputs)
    : [];
  spans.end(mediaSpan, { count: processedMedia.length });

  // ── Build prompt with refreshed history + summaries + processed media ──
  const conversationId = conversation?.id;
  const historySpan = spans.start("load_history", { conversationId });
  const history = conversationId ? await host.getConversationHistory(conversationId, 20) : [];
  spans.end(historySpan, { count: history.length });

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
  const prefetchProfile = buildToolProfile(agent, job, history, null);
  const knowledgeSpan = spans.start("knowledge_prefetch", { skipped: prefetchProfile.fastChat });
  const knowledgePrefetch = prefetchProfile.fastChat ? null : await prefetchKnowledge(agent, job);
  spans.end(knowledgeSpan, { passages: knowledgePrefetch?.passages?.length ?? 0 });

  const promptSpan = spans.start("build_prompt");
  const built = buildPrompt(agent, job, history, conversation, processedMedia, taskCheckpoint, knowledgePrefetch);
  spans.end(promptSpan, { chars: built.promptText.length });

  // Shared state so the search_integrations tool can call setMcpServers()
  // to dynamically add Composio toolkits mid-session (same user interaction).
  const queryState = createQueryState();

  const optionsSpan = spans.start("build_query_options");
  const builtOptions = await buildQueryOptions(agent, job, queryState, history, knowledgePrefetch);
  const {
    options,
    relevantToolkits,
    connectedToolkits,
    profile,
    promptAgent,
  } = builtOptions;
  let warmKey = builtOptions.warmKey;
  spans.end(optionsSpan, {
    relevantToolkits,
    connectedToolkits: connectedToolkits.length,
    fastChat: profile.fastChat,
    mcpServers: Object.keys((options.mcpServers as Record<string, unknown>) || {}),
  });

  // Layer 1: pre-load toolkits the agent used in its last 3 runs — warm start
  // so "try again" doesn't need to re-search. Other toolkits load on-demand.
  queryState.loadedToolkits = new Set(relevantToolkits);
  // System prompt advertises all connected toolkits (not just the routed subset)
  // so the agent knows what's available if it wants to call search_integrations.
  // Item: per-user vs per-org integrations. The originating user's id (from
  // the inbound channel poller / Rails webhook) lets us also load that user's
  // private toolkits — e.g. their personal Gmail — alongside the workspace
  // shared ones. Falls back to org-only when the job has no associated user.
  const teammatesSpan = spans.start("load_teammates");
  const teammates = (profile.tasks ? await host.getTeammates(agent.organization_id, agent.id) : []).map((t) => ({
    name: t.name,
    slug: t.slug,
    role: t.role,
    managerId: t.manager_id,
    summary: t.summary,
    skills: t.skills,
  }));
  spans.end(teammatesSpan, { count: teammates.length });

  const systemPromptSpan = spans.start("system_prompt");
  const systemPrompt = getCachedSystemPrompt(promptAgent, skills, connectedToolkits, teammates);
  options.systemPrompt = systemPrompt.prompt;
  spans.end(systemPromptSpan, {
    cacheHit: systemPrompt.cacheHit,
    key: systemPrompt.key,
    chars: systemPrompt.prompt.length,
  });
  if (resumeSessionId) {
    options.resume = resumeSessionId;
    warmKey = null;
  }
  if (isReportbackJob) {
    // Report-backs should transform a downstream result into a concise update.
    // Letting them use tools caused fresh research / document creation loops.
    options.allowedTools = [];
    options.mcpServers = {};
    logger.info("Report-back mode: tools disabled for this run");
  }

  try {
    // SDK handles resume natively. Session rotation keeps transcripts small
    // (30-turn cap), so load times stay reasonable. BullMQ's job lock (10 min)
    // catches pathological hangs.
    const modelTurnSpan = spans.start("agent_loop", { resumed: !!resumeSessionId });
    let result = await runAgentLoop(built.promptText, options, queryState, spans, jobId, warmKey);
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
      result = await runAgentLoop(built.promptText, options, queryState, spans, jobId, null);
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
      const messageMetadata: Record<string, unknown> = {};
      if (sentMedia.length > 0) {
        messageMetadata.media = sentMedia.map((m) => ({
          url: m.url,
          filename: m.filename,
          contentType: m.contentType,
          signedId: m.signedId,
        }));
      }
      // tool_history is what the chat UI reads to render the persistent
      // tool-step pills (Perplexity-style). Same shape we use for the live
      // cable stream — frontend can rehydrate without a separate endpoint.
      if (result.toolHistory && result.toolHistory.length > 0) {
        messageMetadata.tool_history = result.toolHistory;
      }
      // Extended-thinking trace, if any. Surfaced as a "Thought for Xs"
      // pill above the assistant content — collapsed by default.
      if (result.thinkingText && result.thinkingText.length > 0) {
        messageMetadata.thinking = {
          text: result.thinkingText.slice(0, 4000),
          duration_ms: result.thinkingDurationMs,
        };
      }
      // job_id ties the message to its audit_log row; the chat UI uses
      // this to deep-link the "View trace" action to /ops/traces/by_job.
      messageMetadata.job_id = jobId;
      const saved = await host.saveMessage(
        conversationId,
        "assistant",
        result.responseContent,
        "outbound",
        job.channel,
        [],
        Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
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
          // Forward the persisted metadata so the chat UI can read
          // job_id (for the View Trace link) and tool_history off the
          // live event without waiting for a refetch.
          metadata: { conversation_id: conversationId, ...messageMetadata },
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

      // Slack-as-channel: emitDone only fires in-process listeners (web chat).
      // For Slack, post the final response to the channel the inbound message
      // came from. Threading respects the inbound ts so reply lands in-thread
      // when the user @mentioned in a thread, top-level otherwise.
      if (job.channel === "slack" && finalResponse?.trim()) {
        const meta = (job.payload?.metadata || {}) as Record<string, unknown>;
        const channel = (meta.channel as string) || "";
        const threadTs = (meta.thread_ts as string) || (meta.ts as string) || undefined;
        const { deliverSlackReply } = await import("./channels/slack.js");
        await deliverSlackReply({
          agentId: agent.id,
          channel,
          text: finalResponse,
          thread_ts: threadTs,
        }).catch((err) => logger.error("Slack reply delivery failed", err));
      }
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
      const task = await host.getTask(job.payload.taskId).catch(() => null);
      const terminalOrPaused = task && ["awaiting_input", "failed", "cancelled"].includes(task.status);
      if (terminalOrPaused) {
        logger.info(`Task ${job.payload.taskId}: not auto-completing because current status is ${task.status}`);
      } else {
        const validation = validateTaskDeliverable(job, result, finalResponse);
        if (!validation.ok) {
          logger.warn(`Task ${job.payload.taskId}: deliverable validation failed`, { reason: validation.reason });
          await host.updateTask(job.payload.taskId, {
            status: validation.status || "failed",
            result: {
              response: finalResponse.slice(0, 10000),
              validation_error: validation.reason,
            },
          }).catch(() => {});
          await host.addTaskComment(job.payload.taskId, agent.id, `Task did not pass completion validation: ${validation.reason}`).catch(() => {});
        } else {
          await host.updateTask(job.payload.taskId, { status: "done", result: { response: finalResponse.slice(0, 10000) } }).catch(() => {});
        }
      }
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
            conversationId: task.conversation_id ?? null,
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
      const { queue } = await import("./queue.js");
      await queue.add(retryPayload.type, retryPayload, {
        delay: delaySec * 1000,
        jobId: retryPayload.jobId,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
      // Leave task in_progress so the kanban shows the work is still
      // happening rather than failed.
      if (job.type === "task_assignment" && job.payload?.taskId) {
        await host.updateTask(job.payload.taskId, { status: "in_progress" }).catch(() => {});
      }
      await host.saveAuditLog(
        agent.organization_id,
        agent.id,
        job.type,
        undefined,
        { prompt: built.promptText?.slice(0, 500), jobId },
        { error: errMsg, retry_in_seconds: delaySec, retry_count: retryCount + 1 },
        "retrying",
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
      ).catch(() => {});
      // Tell the user channel this is happening, but don't error-emit.
      if (job.origin?.channel) {
        await deliverToOrigin(job.origin, `⏳ Hit a ${isRateLimit ? "rate limit" : "transient error"} on this turn — retrying in ${delaySec}s.`).catch(() => {});
      }
      return; // skip the failed-status / error emit below
    }

    emitError(errMsg);

    // Persist the error as an assistant message so the chat UI's
    // "agent is thinking" heuristic clears across reload (the heuristic
    // looks for an assistant reply newer than the latest user message;
    // without this, an auth/rate-limit failure leaves the indicator
    // permanently pinned). Also keeps the error visible in chat history.
    if (conversation?.id && job.type === "inbound_message") {
      await host
        .saveMessage(
          conversation.id,
          "assistant",
          `⚠️ Run failed: ${errMsg.slice(0, 500)}`,
          "outbound",
          job.channel || "web",
          undefined,
          { error: true },
        )
        .catch((e) => {
          logger.warn("Failed to persist error message", { error: (e as Error).message });
        });
    }

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

// Legacy quick-check kept for callers that haven't been migrated to the full
// token-based decideRotation policy. Returns the conservative answer: only
// resume if there's a session, it's under the hard cap, and we haven't been
// idle longer than the time-gap threshold.
function shouldResumeSession(conversation: Conversation): boolean {
  if (!conversation.claude_session_id) return false;
  if ((conversation.claude_session_turn_count ?? 0) >= SESSION_TURN_HARD_CAP) return false;
  if (conversation.last_message_at) {
    const hoursSince =
      (Date.now() - new Date(conversation.last_message_at).getTime()) / 3_600_000;
    if (hoursSince > DEFAULT_ROTATION.timeGapHours) return false;
  }
  return true;
}

// ── Internals ──────────────────────────────────────────────────

interface ToolHistoryEntry {
  id: string;
  tool: string;
  label: string;
  input?: unknown;
  result?: string;
  is_error?: boolean;
  started_at: string;
  ended_at?: string;
  parent_tool_use_id?: string;
}

interface QueryResult {
  responseContent: string;
  interceptor: ToolInterceptor;
  capturedSessionId: string | null;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
  toolHistory: ToolHistoryEntry[];
  thinkingText: string;
  thinkingDurationMs: number;
}

function validateTaskDeliverable(
  job: JobData,
  result: QueryResult,
  finalResponse: string,
): { ok: true } | { ok: false; reason: string; status?: "failed" | "awaiting_input" } {
  const instruction = [
    job.payload?.instruction || "",
    job.payload?.body || "",
    job.payload?.subject || "",
  ].join("\n").toLowerCase();
  const response = (finalResponse || "").toLowerCase();
  const toolNames = result.toolHistory.map((t) => t.tool);

  if (!finalResponse || finalResponse.trim().length === 0) {
    return { ok: false, reason: "agent returned an empty response" };
  }

  if (hasIntegrationIntent(instruction, "spreadsheet")) {
    const spreadsheetToolkits = toolkitsForIntent("spreadsheet").map((toolkit) => toolkit.toUpperCase());
    const usedSpreadsheetTool = toolNames.some((name) => spreadsheetToolkits.some((prefix) => name.includes(prefix)));
    const usedDocumentTool = toolNames.some((name) => /GOOGLEDOCS|NOTION/.test(name));
    const hasSheetUrl = /docs\.google\.com\/spreadsheets/i.test(finalResponse);
    const explicitBlocked = /\b(not connected|needs auth|connection|blocked|unavailable|failed|cannot access)\b/.test(response);

    if (usedDocumentTool && !usedSpreadsheetTool) {
      return {
        ok: false,
        reason: "requested a spreadsheet but the run used document tools instead of spreadsheet/table tools",
      };
    }
    if (!usedSpreadsheetTool && !hasSheetUrl && !explicitBlocked) {
      return {
        ok: false,
        reason: "requested a spreadsheet but no spreadsheet/table tool call or spreadsheet URL was produced",
      };
    }
  }

  if (hasIntegrationIntent(instruction, "lead_enrichment")) {
    const leadToolkits = toolkitsForIntent("lead_enrichment").map((toolkit) => toolkit.toUpperCase());
    const usedLeadTool = toolNames.some((name) => leadToolkits.some((prefix) => name.includes(prefix)));
    const fallbackAllowed = /\b(fallback|fall back|web|linkedin|manual|manually|do it yourself)\b/.test(instruction);
    const explicitBlocked = /\b(not connected|needs auth|connection|blocked|unavailable|failed|rate limit|429)\b/.test(response);
    if (!usedLeadTool && !fallbackAllowed && !explicitBlocked) {
      return {
        ok: false,
        reason: "requested lead/contact enrichment but no lead/CRM tool call or explicit blocker was recorded",
      };
    }
  }

  return { ok: true };
}

async function runAgentLoop(
  promptText: string,
  options: Record<string, unknown>,
  queryState: QueryState,
  spans: SpanCollector | undefined,
  jobId: string,
  warmKey: string | null,
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

  const queryCreateSpan = spans?.start("sdk_query_create", { warmKey });
  const queryHandle = await createSdkQuery(userMessageStream(), options as Options, warmKey);
  spans?.end(queryCreateSpan ?? -1, { warmed: queryHandle.warmed });
  const q = queryHandle.query;
  queryState.current = q;

  // Track open tool_use spans so we can close them when matching tool_result arrives
  const toolUseSpans = new Map<string, number>();
  // Per-message timeline of tool invocations — persisted as metadata.tool_history
  // on the assistant Message so the chat UI can render the same step list it
  // shows live (Perplexity-style). Keyed by tool_use id for matching results.
  const toolHistory: ToolHistoryEntry[] = [];
  const toolHistoryById = new Map<string, ToolHistoryEntry>();
  // Sub-agent stack for tool-step nesting. When the SDK calls the `Agent`
  // tool to delegate to a sub-agent, we push that tool_use id; every
  // subsequent tool_use is tagged with parentToolUseId = top-of-stack so
  // the chat UI can render Sam's tools indented under Casper's `Agent`
  // step. Pop on the matching tool_result.
  const activeAgentStack: string[] = [];
  // Extended-thinking accumulator. Each thinking block from the SDK is
  // appended; durations are bracketed by first/last block timestamps.
  // Surface as a "Thought for Xs" pill above the assistant content.
  let thinkingText = "";
  let thinkingStart: number | null = null;
  let thinkingEnd: number | null = null;
  let streamingText = "";
  let lastStreamEmitAt = 0;
  let lastStreamEmitLength = 0;
  const emitStreamingText = (force = false) => {
    const now = Date.now();
    if (!force && now - lastStreamEmitAt < 80 && streamingText.length - lastStreamEmitLength < 64) return;
    lastStreamEmitAt = now;
    lastStreamEmitLength = streamingText.length;
    emitTextDelta(jobId, streamingText);
    spans?.event("text_delta", { length: streamingText.length });
  };

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
      spans?.event("sdk_init", {
        warmed: queryHandle.warmed,
        composioTools: composioTools.length,
        mcpTools: mcpTools.length,
        hasKnowledge,
      });
      void q.getContextUsage()
        .then((usage) => {
          logger.info(`SDK context usage: ${JSON.stringify(usage).slice(0, 1200)}`);
          spans?.event("sdk_context_usage", usage as unknown as Record<string, unknown>);
        })
        .catch((err) => {
          logger.warn("SDK context usage unavailable", { error: (err as Error).message });
        });
      const expectedKnowledge = Array.isArray(options.allowedTools) &&
        (options.allowedTools as string[]).includes("mcp__knowledge__search_knowledge");
      if (expectedKnowledge && !hasKnowledge) {
        logger.warn(`search_knowledge NOT in allowedTools! MCP tools seen: ${mcpTools.join(", ")}`);
      }
    }

    if (msg.type === "stream_event" && msg.event) {
      const event = msg.event;
      if (event.type === "message_start") {
        streamingText = "";
        lastStreamEmitAt = 0;
        lastStreamEmitLength = 0;
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        streamingText += event.delta.text || "";
        responseContent = streamingText;
        emitStreamingText(false);
      } else if (event.type === "content_block_stop" && streamingText.length > 0) {
        emitStreamingText(true);
      }
    }

    if (msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
          // Extended-thinking trace from the model. Each block is a complete
          // chunk (the SDK accumulates streaming deltas before delivering).
          // We surface them live to the chat UI and persist the totals.
          thinkingText += (thinkingText ? "\n\n" : "") + block.thinking;
          if (thinkingStart === null) thinkingStart = Date.now();
          thinkingEnd = Date.now();
          emitThinkingDelta(jobId, thinkingText);
          spans?.event("thinking_block", { length: block.thinking.length });
        }
        if (block.type === "text" && block.text) {
          responseContent = block.text;
          emitTextDelta(jobId, block.text);
          spans?.event("text_block", { length: block.text.length });
        }
        if (block.type === "tool_use") {
          // Tag this tool_use with the currently-active Agent delegation, if
          // any, so the chat UI can render it nested under that block.
          const parentToolUseId = activeAgentStack[activeAgentStack.length - 1];
          emitToolCall(jobId, block.name, block.input, block.id, parentToolUseId);
          interceptor.observe(block);
          // Persisted timeline entry — matched by tool_use id when the result
          // arrives. Truncate input to keep metadata row size bounded.
          if (block.id) {
            const inputStr = JSON.stringify(block.input ?? {});
            const entry: ToolHistoryEntry = {
              id: block.id,
              tool: block.name,
              label: getToolLabel(block.name, block.input),
              input: inputStr.length > 1000 ? `${inputStr.slice(0, 1000)}…` : block.input,
              started_at: new Date().toISOString(),
              parent_tool_use_id: parentToolUseId,
            };
            toolHistory.push(entry);
            toolHistoryById.set(block.id, entry);
            // Agent delegation: push so children get nested under us.
            if (block.name === "Agent") activeAgentStack.push(block.id);
          }
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
          // Look up the original tool name by the tool_use_id — Claude SDK
          // doesn't put `name` on tool_result blocks, only `tool_use_id`.
          // Without this lookup, all results were emitted as tool="tool"
          // and the chat UI never matched them to their pending pill.
          const matchedEntry = block.tool_use_id ? toolHistoryById.get(block.tool_use_id) : undefined;
          const resultTool = matchedEntry?.tool || block.name || "tool";
          // SDK puts `is_error: true` on failed tool_result blocks. Pass
          // through so the chat UI can paint the step red instead of the
          // usual checkmark + tucked-away-result-drawer.
          const isError = block.is_error === true;
          emitToolResult(resultTool, content, block.tool_use_id, isError);
          // Close the matching history entry — store a 500-char snippet so
          // the UI can show "click to expand result" without bloating rows.
          if (block.tool_use_id && matchedEntry) {
            matchedEntry.result = typeof block.content === "string" ? block.content.slice(0, 500) : undefined;
            matchedEntry.ended_at = new Date().toISOString();
            matchedEntry.is_error = isError;
            toolHistoryById.delete(block.tool_use_id);
          }
          // Pop the Agent stack when a delegation completes.
          const stackTop = activeAgentStack[activeAgentStack.length - 1];
          if (stackTop && stackTop === block.tool_use_id) {
            activeAgentStack.pop();
          }
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

  const thinkingDurationMs = (thinkingStart != null && thinkingEnd != null)
    ? Math.max(0, thinkingEnd - thinkingStart)
    : 0;
  return { responseContent, interceptor, capturedSessionId, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens, toolHistory, thinkingText, thinkingDurationMs };
}

interface BuiltQueryOptions {
  options: Record<string, unknown>;
  relevantToolkits: string[];
  connectedToolkits: string[];
  warmKey: string | null;
  profile: ToolProfile;
  promptAgent: Agent;
}

interface ToolProfile {
  recall: boolean;
  sendMedia: boolean;
  scheduling: boolean;
  tasks: boolean;
  approvals: boolean;
  knowledge: boolean;
  integrations: boolean;
  fastChat: boolean;
}

function capRoutingText(text: string): string {
  const cap = Number(process.env.ENGINE_ROUTING_TEXT_MAX_CHARS || 6000);
  return text.length > cap ? text.slice(0, cap) : text;
}

function buildCurrentTurnText(job: JobData): string {
  return capRoutingText([
    job.payload?.instruction || "",
    job.payload?.body || "",
    job.payload?.subject || "",
  ].join(" "));
}

function buildRoutingText(job: JobData, history: Message[] = []): string {
  return capRoutingText([
    buildCurrentTurnText(job),
    ...history.slice(-2).map((m) => m.content),
  ].join(" "));
}

function buildToolProfile(
  agent: Agent,
  job: JobData,
  history: Message[] = [],
  knowledgePrefetch?: { passages?: unknown[] } | null,
): ToolProfile {
  const caps = resolveCapabilities(agent);
  // Tool profile decides what MCP servers to boot for this turn. Keep this
  // strictly current-turn based; old conversation messages are too noisy and
  // were causing simple replies to load tasks/integrations because the prior
  // thread mentioned sheets, Apollo, email, etc.
  const text = buildCurrentTurnText(job);
  const isInbound = job.type === "inbound_message";
  const isTask = job.type === "task_assignment";
  const isScheduled = job.type === "scheduled_task" || job.type === "heartbeat";
  const hasAttachments = Boolean(job.payload?.attachments?.length || job.payload?.attachment_ids?.length);
  const integrationIntent = detectIntegrationIntents(text).length > 0 || /\b(connect|integration|oauth|apollo|gmail|google\s*(sheets?|docs?|calendar|drive|meet)|google[-\s]?meet|zoom|calendly|hubspot|salesforce|pipedrive|stripe|slack|notion|airtable|github|vercel|linkedin)\b/i.test(text);
  const taskIntent = /\b(task|todo|delegate|assign|ask\s+(sam|alex|casper)|follow\s*up|progress|status update)\b/i.test(text);
  const schedulingIntent = /\b(remind|reminder|schedul(e|ing)|calendar|meeting|appointment|cron|availab(le|ility)|free\s+time|free\s+slot|open\s+slot|time\s+slot|book(ing)?\s+(a|some|time)|find\s+(a\s+)?time|suggest\s+(some\s+)?times?|when\s+(are\s+you|can\s+we)|what\s+times?|every\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|next\s+week)\b/i.test(text);
  const recallIntent = /\b(remember|previous|earlier|last time|what did (i|we|you)|history|conversation)\b/i.test(text);
  const knowledgeIntent = /\b(policy|contract|document|docs|knowledge|playbook|uploaded|company info|handbook)\b/i.test(text);
  const mediaIntent = hasAttachments || /\b(send|create|attach|voice|audio|image|screenshot|file|pdf|csv)\b/i.test(text);
  const webIntent = /\b(find|search|research|look up|latest|current|today|news|website|web)\b/i.test(text);
  const timeIntent = /\b(what time|current time|date today|what date|right now)\b/i.test(text);
  const confirmationIntent = /\b(approve|approval|confirm|confirmation|permission|ask me first|ask before|before you|ok to|okay to|should i|would you like|reply yes|yes\/no|send it|publish it|post it|delete it|spend)\b/i.test(text);

  const profile: ToolProfile = {
    recall: Boolean(caps.recall.enabled && (isTask || isScheduled || recallIntent)),
    sendMedia: Boolean(caps.send_media.enabled && (isTask || isScheduled || mediaIntent)),
    scheduling: Boolean(caps.scheduling.enabled && (isTask || isScheduled || schedulingIntent)),
    tasks: Boolean(caps.tasks.enabled && (isTask || isScheduled || taskIntent)),
    approvals: Boolean(caps.tasks.enabled && (isTask || isScheduled || taskIntent || integrationIntent || confirmationIntent)),
    knowledge: Boolean(caps.knowledge_base.enabled && (isTask || isScheduled || knowledgeIntent || (knowledgePrefetch?.passages?.length ?? 0) > 0)),
    // Scheduling intent (meeting/appointment/availability) implies we need
    // calendar tools — most agents that handle inbound mail need to look at
    // a calendar to answer "when can we meet?". Codex's prior heuristic gated
    // this on explicit toolkit names ("google calendar"), which missed the
    // common case of "find some time on google meet" / "book a slot".
    integrations: Boolean(caps.integrations.enabled && (isTask || isScheduled || integrationIntent || schedulingIntent)),
    fastChat: false,
  };

  profile.fastChat = Boolean(
    isInbound &&
    !hasAttachments &&
    !profile.recall &&
    !profile.sendMedia &&
    !profile.scheduling &&
    !profile.tasks &&
    !profile.knowledge &&
    !profile.integrations &&
    !webIntent &&
    !timeIntent &&
    !confirmationIntent
  );

  return profile;
}

function agentForToolProfile(agent: Agent, profile: ToolProfile): Agent {
  const capabilities = {
    ...agent.capabilities,
    recall: { ...(agent.capabilities.recall || { enabled: false }), enabled: profile.recall },
    send_media: { ...(agent.capabilities.send_media || { enabled: false }), enabled: profile.sendMedia },
    scheduling: { ...(agent.capabilities.scheduling || { enabled: false }), enabled: profile.scheduling },
    tasks: { ...(agent.capabilities.tasks || { enabled: false }), enabled: profile.tasks },
    knowledge_base: { ...(agent.capabilities.knowledge_base || { enabled: false }), enabled: profile.knowledge },
    integrations: { ...(agent.capabilities.integrations || { enabled: false }), enabled: profile.integrations },
  };
  return { ...agent, capabilities };
}

async function buildQueryOptions(
  agent: Agent,
  job: JobData,
  queryState: QueryState,
  history: Message[] = [],
  knowledgePrefetch?: { passages?: unknown[] } | null,
): Promise<BuiltQueryOptions> {
  if (config.anthropicBaseUrl) {
    process.env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl;
  }

  // Capability-gated MCP server registration. Agents only pay for tools
  // they have enabled. See `capabilities.ts` for defaults.
  const caps = resolveCapabilities(agent);
  const profile = buildToolProfile(agent, job, history, knowledgePrefetch);
  const promptAgent = agentForToolProfile(agent, profile);
  const subAgents = profile.tasks ? await buildSubAgentDefinitions(agent) : {};
  const mcpServers: Record<string, unknown> = {};
  const baseMcpServers: Record<string, unknown> = {};

  if (caps.recall.enabled && profile.recall) {
    const recallServer = buildRecallMcpServer(agent.organization_id);
    mcpServers.recall = recallServer;
    baseMcpServers.recall = recallServer;
  }

  if (caps.send_media.enabled && profile.sendMedia) {
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

  if (caps.scheduling.enabled && profile.scheduling) {
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

  if (caps.tasks.enabled && profile.tasks) {
    const tasksServer = buildTasksMcpServer(agent.id, agent.organization_id, taskOrigin, job.payload?.taskId);
    mcpServers.tasks = tasksServer;
    baseMcpServers.tasks = tasksServer;
  }

  if (caps.tasks.enabled && profile.approvals) {
    // Item 4 — generic approval tool (request_approval). Kept separately
    // from task tools so integration-heavy inbound jobs can request approval
    // without loading the whole task-management surface.
    const approvalsServer = buildApprovalsMcpServer({
      agentId: agent.id,
      orgId: agent.organization_id,
      origin: taskOrigin,
    });
    mcpServers.approvals = approvalsServer;
    baseMcpServers.approvals = approvalsServer;
  }

  if (caps.knowledge_base.enabled && profile.knowledge) {
    const knowledgeServer = buildKnowledgeMcpServer(agent.id, agent.organization_id);
    mcpServers.knowledge = knowledgeServer;
    baseMcpServers.knowledge = knowledgeServer;
  }

  // Stored-credentials access — exposes `secrets.get` so the agent can fetch
  // cloud-provider / generic API keys the workspace owner has stored. Rails
  // (Api::SecretsController) enforces the ACL via agent_credential_grants;
  // every fetch writes an audit_logs row. Always-on — the ACL is the gate,
  // not the tool's availability.
  const secretsServer = buildSecretsMcpServer({
    agentId: agent.id,
    orgId: agent.organization_id,
    origin: taskOrigin,
  });
  mcpServers.secrets = secretsServer;
  baseMcpServers.secrets = secretsServer;

  // Self-authoring skills MCP — agents can compose new SKILL.md bundles and
  // install them on themselves via skills.create + skills.install_on_me.
  // Always-on; org scoping flows from agent.id → agent.organization_id on
  // the Rails side.
  const skillsCreatorServer = buildSkillsCreatorMcpServer({ agentId: agent.id });
  mcpServers.skills = skillsCreatorServer;
  baseMcpServers.skills = skillsCreatorServer;

  // Slack-as-channel outbound. Gated on whether this agent has a connected
  // Slack ChannelConfig — without one, the tool would always 404 so we skip
  // registering it. The bot_token lives only in Rails; engine never sees it.
  try {
    const channelConfigs = await host.getChannelConfigs(String(agent.id));
    const hasSlack = channelConfigs.some(
      (c: { channel_type: string; enabled?: boolean }) => c.channel_type === "slack" && c.enabled !== false,
    );
    if (hasSlack) {
      const slackServer = createSlackChannelMcpServer({ agentId: agent.id });
      mcpServers["slack-channel"] = slackServer;
      baseMcpServers["slack-channel"] = slackServer;
    }
  } catch (err) {
    logger.warn("slack-channel registration skipped:", err);
  }

  // Integrations capability gates both `integrations` (search) and
  // `composio` (actual execution tools). Disable the capability to
  // produce a pure-knowledge/internal agent with no external tool access.
  let composioToolNames: string[] = [];
  let relevantToolkits: string[] = [];
  let allConnectedToolkits: string[] = [];
  if (caps.integrations.enabled && profile.integrations) {
    const buildOriginatingUserId = (job.payload?.metadata as Record<string, unknown> | undefined)?.user_id as number | undefined
      ?? (job as { user_id?: number }).user_id;
    const integrationsServer = buildIntegrationSearchMcpServer(agent.organization_id, queryState, buildOriginatingUserId);
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
    const availableToolkits = await getActiveToolkits(agent.organization_id, buildOriginatingUserId);
    allConnectedToolkits = availableToolkits;
    const toolRouting = process.env.TOOL_ROUTING || "smart";

    const layer1 = await getRecentComposioToolkits(agent.id);

    const routingText = buildRoutingText(job, history);
    const { searchToolkits, isEmbeddingReady } = await import("./integrations/tool-embeddings.js");
    const layer2 = isEmbeddingReady() ? await searchToolkits(routingText, availableToolkits, 3, 0.3) : [];

    // Layer 0 — deterministic routing by service mention and broad intent
    // category. This avoids one-off rules for every integration while still
    // keeping "spreadsheet" on spreadsheet tools, "lead enrichment" on lead
    // tools, etc.
    const layer0Decision = routeIntegrationRequest(routingText, availableToolkits, layer2);
    const layer0 = layer0Decision.matches;

    relevantToolkits = toolRouting === "all"
      ? availableToolkits
      : [...new Set([...layer0, ...layer1])].filter((t) => availableToolkits.includes(t));

    logger.info(
      `Tool routing: ${relevantToolkits.length === 0 ? "search-only" : relevantToolkits.join(", ")} ` +
      `(layer0=${layer0.join(",") || "-"}, intents=${layer0Decision.intents.join(",") || "-"}, layer1=${layer1.join(",") || "-"}, layer2=${layer2.join(",") || "-"}, available: ${availableToolkits.join(", ") || "none"})`,
    );

    // Per-agent ACL — engine drops Composio tools the policy rejects before
    // the agent ever sees them. Empty array (no rows) = default policy
    // (allow everything common), preserving back-compat.
    const toolPolicies = await host.getAgentToolPolicies(agent.id);
    const composioResult = await getComposioMcpServer(agent.organization_id, relevantToolkits, buildOriginatingUserId, toolPolicies);
    const composioServer = composioResult?.server;
    composioToolNames = composioResult?.toolNames || [];

    if (composioServer) {
      mcpServers.composio = composioServer;
      // Note: composio is NOT in baseMcpServers — search_integrations
      // swaps composio servers via setMcpServers, but keeps the base set intact.
    }
  } else if (caps.integrations.enabled) {
    logger.info(`Tool routing: skipped for job profile (fastChat=${profile.fastChat})`);
  } else {
    logger.info(`Tool routing: integrations capability disabled — no composio/integrations MCP servers`);
  }

  // Store base (non-composio) servers so search_integrations can include
  // them in its setMcpServers call — otherwise setMcpServers would nuke them.
  queryState.baseMcpServers = baseMcpServers;

  logger.info(`MCP servers registered: ${Object.keys(mcpServers).join(", ") || "none"}`);

  const builtinTools = profile.fastChat
    ? []
    : [
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
    ];

  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    // SDK isolation — don't load the user's ~/.claude/settings.json (which
    // brings in personal MCP servers like Linear/Sentry/Gmail and pollutes
    // the agent's tool list with 60+ unrelated tools).
    settingSources: [],
    // Block the SDK's built-in scheduling primitives. They schedule in-process
    // and DON'T persist past this conversation, so when the agent calls them
    // for "send X in 5 minutes" the work vanishes the moment the SDK closes
    // the session or the engine machine sleeps. Force the agent to our
    // persistent mcp__scheduling__* tools instead.
    disallowedTools: ["CronCreate", "CronDelete", "CronList", "CronUpdate", "ScheduleWakeup"],
    allowedTools: [
      ...builtinTools,
      // Capability-gated MCP tools — only listed when their server is registered
      ...(caps.recall.enabled && profile.recall ? [
        "mcp__recall__search_messages",
        "mcp__recall__search_activity",
      ] : []),
      ...(caps.send_media.enabled && profile.sendMedia ? [
        "mcp__send-media__send_voice",
        "mcp__send-media__send_image",
        "mcp__send-media__send_file",
      ] : []),
      ...(caps.integrations.enabled && profile.integrations ? [
        "mcp__integrations__search_integrations",
        // Composio tools: explicit list (wildcards may not match)
        ...composioToolNames.map((name) => `mcp__composio__${name}`),
      ] : []),
      ...(caps.knowledge_base.enabled && profile.knowledge ? [
        "mcp__knowledge__search_knowledge",
        "mcp__knowledge__share_to_org",
      ] : []),
      ...(caps.scheduling.enabled && profile.scheduling ? [
        "mcp__scheduling__schedule_task",
        "mcp__scheduling__set_reminder",
        "mcp__scheduling__list_schedules",
        "mcp__scheduling__delete_schedule",
      ] : []),
      ...(caps.tasks.enabled && profile.tasks ? [
        "mcp__tasks__create_task",
        "mcp__tasks__list_tasks",
        "mcp__tasks__update_task",
        "mcp__tasks__comment_on_task",
        "mcp__tasks__write_checkpoint",
        "mcp__tasks__ask_user",
        "mcp__tasks__cancel_self",
        // Item 2 — mid-task collaboration primitives
        "mcp__tasks__progress_update",
        "mcp__tasks__ask_agent",
        "mcp__tasks__escalate",
      ] : []),
      ...(caps.tasks.enabled && profile.approvals ? [
        "mcp__approvals__request_approval",
      ] : []),
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    agentProgressSummaries: true,
    includePartialMessages: true,
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

  // Extended thinking: surfaces the model's reasoning trace as a "Thought
  // for Xs" pill in chat. Only useful on Claude 4 / Sonnet 4.x / Opus 4.x —
  // older models silently ignore the budget. Configured per-agent via
  // ai_config.thinking_level in Rails; provisioner forwards the value as
  // ENGINE_THINKING_LEVEL. Legacy ENGINE_ENABLE_THINKING=true maps to
  // "medium" so the env-only path keeps working.
  const thinkingLevel = (process.env.ENGINE_THINKING_LEVEL || "").toLowerCase()
    || (process.env.ENGINE_ENABLE_THINKING === "true" ? "medium" : "none");
  const thinkingBudget: Record<string, number> = {
    low: 2000,
    medium: 4000,
    high: 8000,
  };
  if (thinkingBudget[thinkingLevel]) {
    options.maxThinkingTokens = thinkingBudget[thinkingLevel];
  }

  const mcpCount = Object.keys(mcpServers).length;
  const warmKey = profile.fastChat && !options.resume && mcpCount === 0
    ? `agent:${agent.id}:fast-chat:${agent.updated_at ?? "unknown"}:${agent.ai_config?.provider ?? "default"}:${agent.ai_config?.model_id ?? "default"}`
    : null;
  return {
    options,
    relevantToolkits,
    connectedToolkits: allConnectedToolkits,
    warmKey,
    profile,
    promptAgent,
  };
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

  if (channel === "slack") {
    const slackChannel = (meta.channel as string) || "";
    if (!slackChannel) {
      // Fall back to the agent's bound channel — Rails resolves it when the
      // payload omits `channel`. Reasonable for scheduled tasks ("every Monday
      // post the report") where the agent didn't originate from a thread.
      const { deliverSlackReply } = await import("./channels/slack.js");
      await deliverSlackReply({ agentId: agent.id, channel: "", text: content });
      logger.info(`Scheduled delivery: posted to Slack (agent home channel, ${content.length} chars)`);
      return;
    }
    const { deliverSlackReply } = await import("./channels/slack.js");
    await deliverSlackReply({
      agentId: agent.id,
      channel: slackChannel,
      text: content,
      thread_ts: (meta.thread_ts as string) || undefined,
    });
    logger.info(`Scheduled delivery: posted to Slack ${slackChannel} (${content.length} chars)`);
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
