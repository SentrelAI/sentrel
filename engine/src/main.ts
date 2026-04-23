import { config } from "./config.js";
import { host } from "./host/index.js";
import { createWorker } from "./queue.js";
import { runAgent } from "./agent-runner.js";
import { syncWorkspace } from "./memory.js";
import { provisionSkills } from "./skills.js";
import { startWorkScheduler } from "./work-scheduler.js";
import { initToolEmbeddings } from "./integrations/tool-embeddings.js";
import { startHealthReporter, incrementJobCount } from "./health.js";
import { startInboxPoller } from "./inbox.js";
import { startGateway, setSyncHandler } from "./gateway.js";
import { startTelegramPolling, stopTelegramPolling } from "./channels/telegram.js";
import { initWhatsApp, stopWhatsApp } from "./channels/whatsapp.js";
import { initSentry, setAgentContext, captureException, flush as flushSentry } from "./sentry.js";
import { logger, flushLogs } from "./logger.js";
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

  // 4. Init tool embeddings with a bounded wait. First boot downloads ~25MB
  // from HuggingFace Hub then caches on /data/hf-cache (symlinked via
  // env.cacheDir). Subsequent boots load from cache in <1s. We wait up to
  // 30s so the "ready" log reflects a warm tool-router on cold starts,
  // then fall through so Fly egress hiccups don't block the engine. If
  // the download finishes later it still populates the index.
  const embedInit = initToolEmbeddings().catch((err) =>
    logger.warn("Tool embeddings init failed, using fallbacks", { error: (err as Error).message }),
  );
  await Promise.race([
    embedInit,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.warn("Tool embeddings still loading after 30s — continuing without waiting");
        resolve();
      }, 30_000),
    ),
  ]);

  // 5. Update agent status
  await host.updateAgentStatus(agent.id, "running");

  // 5. Start worker
  const worker = createWorker(async (job) => {
    try {
      const currentAgent = await host.getAgent(config.employeeId);
      await runAgent(currentAgent, job.data);
      incrementJobCount();
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
    syncWorkspace(freshAgent);
    provisionSkills(freshAgent);

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

  // 11. Start channels
  startTelegramPolling();
  await initWhatsApp();

  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE ready. Waiting for jobs...");
  logger.info("═══════════════════════════════════════");

  // Fly path: cloud-init isn't used (we boot directly from the image), so
  // the engine itself pings Rails to flip agent_instances.status from
  // "provisioning" → "running". Hetzner path already does this from
  // cloud-init.sh — the duplicate is harmless (Rails just updates the row).
  void reportReady(agent.id);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
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
