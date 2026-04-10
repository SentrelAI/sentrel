import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import type { JobData } from "./types.js";
import { logger } from "./logger.js";

export const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const queue = new Queue(`employee-${config.employeeId}`, {
  connection: { url: config.redisUrl },
});

export function createWorker(handler: (job: Job<JobData>) => Promise<void>): Worker<JobData> {
  const worker = new Worker<JobData>(
    `employee-${config.employeeId}`,
    async (job) => {
      logger.info(`Processing job: ${job.name}`, { jobId: job.id, type: job.data.type });
      await handler(job);
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 1,
      // Long jobs (Claude SDK calls) need much longer locks
      lockDuration: 10 * 60 * 1000, // 10 minutes
      lockRenewTime: 3 * 60 * 1000,  // renew every 3 minutes
      stalledInterval: 5 * 60 * 1000, // check every 5 min
      maxStalledCount: 2,
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Job completed: ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job failed: ${job?.id}`, { error: err.message });
  });

  // Suppress noisy lock renewal errors — they're recoverable
  worker.on("error", (err) => {
    if (err.message.includes("could not renew lock") || err.message.includes("Missing lock")) {
      // Silent — these happen on network blips and don't affect job execution
      return;
    }
    logger.error("Worker error", { error: err.message });
  });

  return worker;
}
