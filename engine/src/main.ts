import { config } from "./config.js";
import { host } from "./host/index.js";
import { createWorker } from "./queue.js";
import { runAgent } from "./agent-runner.js";
import { syncWorkspace } from "./memory.js";
import { provisionSkills, syncSkillsFromDb } from "./skills.js";
import { startWorkScheduler } from "./work-scheduler.js";
import { initToolEmbeddings } from "./rag/embeddings.js";
import { startSupportedIntegrationsCache, stopSupportedIntegrationsCache } from "./integrations/supported.js";
import { startHealthReporter, incrementJobCount } from "./health.js";
import { startInboxPoller } from "./inbox.js";
import { startGateway, setSyncHandler } from "./gateway.js";
import { startTelegramPolling, stopTelegramPolling } from "./channels/telegram.js";
import { initWhatsApp, stopWhatsApp } from "./channels/whatsapp.js";
import { initSentry, setAgentContext, captureException, flush as flushSentry } from "./sentry.js";
import { startAnthropicBillingProxy, stopAnthropicBillingProxy } from "./proxy/anthropic-billing-proxy.js";
import { startOpenAITranslatorProxy, stopOpenAITranslatorProxy } from "./proxy/openai-translator-proxy.js";
import { invalidateSystemPromptCache } from "./runtime/system-prompt-cache.js";
import { drainWarmQueryPool } from "./runtime/warm-query-pool.js";
import { logger, flushLogs } from "./logger.js";
import { startIdleStop, touch } from "./idle-stop.js";
import type { JobData } from "./types.js";

async function main() {
  // Init Sentry before anything else (opt-in via SENTRY_DSN env var)
  initSentry();

  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE starting...");
  logger.info("═══════════════════════════════════════");
  logger.info(`Agent ID: ${config.employeeId}`);

  // 1. Load agent from DB
  const agent = await host.getAgent(config.employeeId);
  logger.info(`Agent: ${agent.name} (${agent.role})`);
  logger.info(`Model: ${agent.ai_config?.provider}/${agent.ai_config?.model_id}`);
  logger.info(`Organization: ${agent.organization?.name}`);
  setAgentContext(agent);

  // 2. Sync workspace (directories + MEMORY.md). Identity comes from
  // buildSystemPrompt() at query time, not from a CLAUDE.md file.
  syncWorkspace(agent);
  logger.info("Workspace synced");

  // 3. Provision role-based skills
  provisionSkills(agent);

  // 4. Init embeddings with a bounded wait. First boot downloads ~25MB
  // from HuggingFace Hub then caches on /data/hf-cache (symlinked via
  // env.cacheDir). Subsequent boots load from cache in <1s. We wait up to
  // 30s so the "ready" log reflects a warm embedder on cold starts,
  // then fall through so Fly egress hiccups don't block the engine. If
  // the download finishes later it still populates the model.
  const embedInit = initToolEmbeddings().catch((err) =>
    logger.warn("Embeddings init failed, using fallbacks", { error: (err as Error).message }),
  );
  let embedTimedOut = false;
  let embedTimeout: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    embedInit,
    new Promise<void>((resolve) =>
      embedTimeout = setTimeout(() => {
        embedTimedOut = true;
        logger.warn("Embeddings still loading after 30s — continuing without waiting");
        resolve();
      }, 30_000),
    ),
  ]);
  if (!embedTimedOut && embedTimeout) clearTimeout(embedTimeout);

  // Item 5 — pull the supported-integrations list from Rails (which proxies
  // the integration broker's catalog). Cached + auto-refreshed every 30 min so
  // adding a new integration server-side makes it usable here without a code
  // change. Boot doesn't block on this — fallback list takes over if the fetch
  // fails.
  void startSupportedIntegrationsCache();

  // 5. Update agent status
  await host.updateAgentStatus(agent.id, "running");

  // 5. Start worker
  // Scheduled work older than this is dropped, not executed. A "daily pass"
  // tick from many hours ago has no value by the time a slept/wedged machine
  // finally drains it — executing it anyway is how stale passes end up
  // answering the user's unrelated chat messages. (Approval-resume jobs are
  // exempt: a decision is actionable whenever it arrives.)
  const MAX_SCHEDULED_JOB_AGE_MS = 3 * 60 * 60 * 1000;

  const worker = createWorker(async (job) => {
    try {
      if (job.data?.type === "scheduled_task" && !String(job.id || "").startsWith("approval-resume-")) {
        const ageMs = Date.now() - job.timestamp;
        if (ageMs > MAX_SCHEDULED_JOB_AGE_MS) {
          logger.warn(`Dropping stale scheduled_task (queued ${Math.round(ageMs / 60000)}m ago, jobId=${job.id})`);
          // Advance last_run_at so the boot-time cron backfill doesn't
          // resurrect the very tick we just dropped.
          const taskId = job.data.payload?.taskId;
          if (taskId) await host.updateScheduledWorkLastRun(taskId).catch(() => {});
          return;
        }
      }
      touch();
      const currentAgent = await host.getAgent(config.employeeId);
      await runAgent(currentAgent, job.data);
      incrementJobCount();
      touch();
    } catch (err) {
      captureException(err, { jobType: job.data?.type, channel: job.data?.channel });
      throw err;
    }
  });
  logger.info(`Worker listening on queue: employee-${config.employeeId}`);

  // Unified scheduling — cron / once / interval all read from scheduled_work.
  await startWorkScheduler();
  logger.info("Work scheduler started");

  // 8. Start health reporter
  startHealthReporter();

  // 9. Start inbox poller (reads from simple Redis list, feeds into BullMQ)
  startInboxPoller();

  // 10. Start gateway (WebSocket + HTTP: POST /sync, GET /health)
  setSyncHandler(async () => {
    const freshAgent = await host.getAgent(config.employeeId);
    invalidateSystemPromptCache(freshAgent.id);
    drainWarmQueryPool(`agent:${freshAgent.id}:`);
    syncWorkspace(freshAgent);
    provisionSkills(freshAgent);
    // DB-installed skills (the ones a user enables on /agents/:id/edit) need
    // to be re-projected to /data/skills now, not on the next inbound run —
    // otherwise the install button feels broken until the user pings the
    // agent. Same logic the agent-runner uses per-job, just fired on demand.
    await syncSkillsFromDb(Number(config.employeeId)).catch((err) => {
      logger.error("Sync handler: syncSkillsFromDb failed", { error: (err as Error).message });
    });

    // Restart channel pollers so rotated Telegram tokens / changed WhatsApp
    // numbers take effect without a full engine restart. Telegram's long-poll
    // may take up to ~30s to drain — that's the cost of not force-killing
    // the fetch. In-flight emitDone routing is unaffected (the listener is
    // global in gateway.ts, bot token is captured by closure).
    try {
      await stopTelegramPolling();
      stopWhatsApp();
      // Small yield so the BullMQ worker pulls any in-flight job before we
      // re-attach listeners.
      await new Promise((r) => setTimeout(r, 50));
      await startTelegramPolling();
      await initWhatsApp();
    } catch (err) {
      logger.error("Channel reload during sync failed", { error: (err as Error).message });
    }

    logger.info(`Config synced (including channels): ${freshAgent.name} (${freshAgent.role})`);
  });
  startGateway();

  // 10b. Start subscription-OAuth proxies if relevant env vars are present.
  // Anthropic OAuth tokens need a billing-identifier header; OpenAI OAuth
  // needs Anthropic Messages → OpenAI Responses translation. Both proxies
  // listen on localhost; agent_provisioner sets ANTHROPIC_BASE_URL to
  // route the SDK through them when provider=anthropic_account / openai_account.
  if (process.env.ANTHROPIC_OAUTH_TOKEN) startAnthropicBillingProxy();
  if (process.env.OPENAI_OAUTH_TOKEN) startOpenAITranslatorProxy();

  // 11. Start channels
  startTelegramPolling();
  await initWhatsApp();

  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE ready. Waiting for jobs...");
  logger.info("═══════════════════════════════════════");

  // Scale-to-zero: exit cleanly after sitting idle; Rails wakes us when
  // new work is queued. onSleep mirrors graceful shutdown minus the
  // status write — the asleep report owns status so the platform can
  // tell "sleeping" (auto-wakes) apart from "stopped" (user's call).
  startIdleStop({
    heartbeatEnabled: !!agent.heartbeat_enabled,
    onSleep: async () => {
      stopAnthropicBillingProxy();
      stopOpenAITranslatorProxy();
      stopSupportedIntegrationsCache();
      await stopTelegramPolling();
      stopWhatsApp();
      await worker.close();
      await flushSentry();
    },
  });

  // Fly path: cloud-init isn't used (we boot directly from the image), so
  // the engine itself pings Rails to flip agent_instances.status from
  // "provisioning" → "running". Hetzner path already does this from
  // cloud-init.sh — the duplicate is harmless (Rails just updates the row).
  void reportReady(agent.id);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    stopAnthropicBillingProxy();
    stopOpenAITranslatorProxy();
    stopSupportedIntegrationsCache();
    await host.updateAgentStatus(agent.id, "stopped");
    await worker.close();
    await flushLogs();
    await flushSentry();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function reportReady(agentId: number): Promise<void> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  if (!rails || !secret) return;
  try {
    const res = await fetch(`${rails}/api/agent_instances/ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Engine-Secret": secret },
      body: JSON.stringify({
        employee_id: agentId,
        public_ip: process.env.FLY_PUBLIC_IP || process.env.PUBLIC_IP || null,
      }),
    });
    if (res.ok) {
      logger.info("Reported ready to Rails");
    } else {
      logger.warn(`Ready report returned HTTP ${res.status}`);
    }
  } catch (err) {
    logger.warn("Could not report ready to Rails — will be picked up on next health check", {
      error: (err as Error).message,
    });
  }
}

main().catch(async (err) => {
  captureException(err, { fatal: true });
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  await flushLogs();
  await flushSentry();
  process.exit(1);
});
