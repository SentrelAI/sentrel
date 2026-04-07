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
    }
  );

  worker.on("completed", (job) => {
    logger.info(`Job completed: ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job failed: ${job?.id}`, { error: err.message });
  });

  return worker;
}
