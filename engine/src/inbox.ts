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
        await queue.add(jobData.type, jobData, {
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        });
        logger.info(`Inbox: received ${jobData.type} job, queued for processing`);
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
