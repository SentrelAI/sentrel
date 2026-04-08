import { config } from "./config.js";
import * as db from "./db.js";
import { createWorker } from "./queue.js";
import { runAgent } from "./agent-runner.js";
import { syncWorkspace } from "./memory.js";
import { provisionSkills } from "./skills.js";
import { startHeartbeat } from "./heartbeat.js";
import { startScheduler } from "./scheduler.js";
import { startHealthReporter, incrementJobCount } from "./health.js";
import { startInboxPoller } from "./inbox.js";
import { startGateway } from "./gateway.js";
import { logger } from "./logger.js";
import type { JobData } from "./types.js";

async function main() {
  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE starting...");
  logger.info("═══════════════════════════════════════");
  logger.info(`Agent ID: ${config.employeeId}`);

  // 1. Load agent from DB
  const agent = await db.getAgent(config.employeeId);
  logger.info(`Agent: ${agent.name} (${agent.role})`);
  logger.info(`Model: ${agent.ai_config?.provider}/${agent.ai_config?.model_id}`);
  logger.info(`Organization: ${agent.organization?.name}`);

  // 2. Sync workspace (CLAUDE.md, MEMORY.md)
  syncWorkspace(agent);
  logger.info("Workspace synced");

  // 3. Provision role-based skills
  provisionSkills(agent);

  // 4. Update agent status
  await db.updateAgentStatus(agent.id, "running");

  // 5. Start worker
  const worker = createWorker(async (job) => {
    // Reload agent for latest config
    const currentAgent = await db.getAgent(config.employeeId);
    await runAgent(currentAgent, job.data);
    incrementJobCount();
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

  // 10. Start gateway WebSocket server
  startGateway();

  logger.info("═══════════════════════════════════════");
  logger.info("  ALCHEMY ENGINE ready. Waiting for jobs...");
  logger.info("═══════════════════════════════════════");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await db.updateAgentStatus(agent.id, "stopped");
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  process.exit(1);
});
