import { redis, queue } from "./queue.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { JobData } from "./types.js";

/**
 * Polls a simple Redis list for inbound jobs.
 * Rails pushes jobs via: LPUSH agent-inbox-{id} {json}
 * This poller reads them and feeds into BullMQ for processing.
 *
 * This avoids Rails needing to know BullMQ's internal format.
 */
export function startInboxPoller(): void {
  const inboxKey = `agent-inbox-${config.employeeId}`;

  async function poll() {
    try {
      // BRPOP blocks until a message arrives (timeout 5s then retry)
      const result = await redis.brpop(inboxKey, 5);
      if (result) {
        const [, raw] = result;
        const jobData: JobData = JSON.parse(raw);
        // Extra M — use jobId as BullMQ jobId for dedup. If a Rails retry
        // pushes the same event twice (same jobId), BullMQ silently ignores.
        const bullmqOpts: Record<string, unknown> = {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          // Inbox jobs are user-originated (chat, email, task assignments) —
          // they jump ahead of queued scheduled/heartbeat work (priority 10)
          // so a backlog of cron ticks can never starve a live conversation.
          priority: 1,
        };
        if (jobData.jobId) {
          bullmqOpts.jobId = jobData.jobId;
        }
        await queue.add(jobData.type, jobData, bullmqOpts);
        logger.info(`Inbox: received ${jobData.type} job (${jobData.jobId || "no-id"}), queued`);
      }
    } catch (err) {
      logger.error("Inbox poll error", { error: (err as Error).message });
    }
    // Loop
    poll();
  }

  poll();
  logger.info(`Inbox poller listening on: ${inboxKey}`);
}
