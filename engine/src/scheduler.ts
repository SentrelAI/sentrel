import { queue } from "./queue.js";
import { config } from "./config.js";
import { host } from "./host/index.js";
import { logger } from "./logger.js";

export async function startScheduler(): Promise<void> {
  await loadSchedules();

  // Poll for new/changed schedules every 60s
  setInterval(loadSchedules, 60_000);
}

async function loadSchedules(): Promise<void> {
  try {
    const tasks = await host.getScheduledTasks(parseInt(config.employeeId));

    for (const task of tasks) {
      await queue.add(
        "scheduled_task",
        {
          type: "scheduled_task" as const,
          agentId: config.employeeId,
          payload: {
            instruction: task.instruction,
            taskId: task.id,
          },
        },
        {
          repeat: { pattern: task.cron_expression },
          jobId: `sched-${task.id}`,
          removeOnComplete: { count: 5 },
          removeOnFail: { count: 3 },
        }
      );
    }

    if (tasks.length > 0) {
      logger.info(`Loaded ${tasks.length} scheduled tasks`);
    }
  } catch (err) {
    logger.error("Failed to load schedules", { error: (err as Error).message });
  }
}
