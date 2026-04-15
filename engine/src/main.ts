import { config } from "./config.js";
import { host } from "./host/index.js";
import { createWorker } from "./queue.js";
import { runAgent } from "./agent-runner.js";
import { syncWorkspace } from "./memory.js";
import { provisionSkills } from "./skills.js";
import { startHeartbeat } from "./heartbeat.js";
import { startScheduler } from "./scheduler.js";
import { startHealthReporter, incrementJobCount } from "./health.js";
import { startInboxPoller } from "./inbox.js";
import { startGateway, setSyncHandler } from "./gateway.js";
import { startTelegramPolling } from "./channels/telegram.js";
import { initWhatsApp } from "./channels/whatsapp.js";
import { initSentry, setAgentContext, captureException, flush as flushSentry } from "./sentry.js";
import { logger } from "./logger.js";
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

  // 4. Update agent status
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

  // 6. Start heartbeat
  await startHeartbeat(agent);

  // 7. Start scheduler
  await startScheduler();

  // 8. Start health reporter
  startHealthReporter();

  // 9. Start inbox poller (reads from simple Redis list, feeds into BullMQ)
  startInboxPoller();

  // 10. Start gateway (WebSocket + HTTP: POST /sync, GET /health)
  setSyncHandler(async () => {
    const freshAgent = await host.getAgent(config.employeeId);
    syncWorkspace(freshAgent);
    provisionSkills(freshAgent);
    logger.info(`Config synced: ${freshAgent.name} (${freshAgent.role})`);
  });
  startGateway();

  // 11. Start channels
  startTelegramPolling();
  await initWhatsApp();

  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE ready. Waiting for jobs...");
  logger.info("═══════════════════════════════════════");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await host.updateAgentStatus(agent.id, "stopped");
    await worker.close();
    await flushSentry();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (err) => {
  captureException(err, { fatal: true });
  await flushSentry();
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  process.exit(1);
});
