// Step 5 — Unified work scheduler.
//
// Replaces scheduler.ts (cron) + heartbeat.ts (interval) + ad-hoc BullMQ
// delayed reminders. Reads from the `scheduled_work` table every 60s and
// registers each row as a BullMQ job using stable jobIds for dedup.
//
// Mode handling:
//   cron     → queue.add(..., { repeat: { pattern, tz }, jobId })
//   interval → queue.add(..., { repeat: { every }, jobId })
//   once     → queue.add(..., { delay, jobId })  (if fire_at is in the future)

import { CronExpressionParser } from "cron-parser";
import { queue } from "./queue.js";
import { config } from "./config.js";
import { host } from "./host/index.js";
import { logger } from "./logger.js";
import type { ScheduledWorkItem } from "./types.js";

// How far back we'll look for a missed cron tick. If the previous expected
// tick was within this window AND we haven't recorded a run past it, fire
// it immediately on engine boot. Beyond this we assume the schedule isn't
// time-sensitive ("daily report" from 3 days ago = stale, drop it).
const CRON_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;

const POLL_INTERVAL_MS = 60_000;

// Track registered work IDs so we can detect removed/paused items and
// clean up their BullMQ jobs.
let registeredWorkIds = new Set<number>();

export async function startWorkScheduler(): Promise<void> {
  // Purge ALL stale repeatable jobs from previous engine runs. BullMQ
  // persists repeatables in Redis across restarts — old schedulers,
  // deleted schedules, and changed cron expressions leave ghost jobs
  // that fire indefinitely. We re-register fresh from the DB below.
  try {
    const stale = await queue.getRepeatableJobs();
    for (const r of stale) {
      await queue.removeRepeatableByKey(r.key);
    }
    if (stale.length > 0) {
      logger.info(`Work scheduler: purged ${stale.length} stale repeatable job(s) from Redis`);
    }
  } catch (err) {
    logger.warn("Work scheduler: failed to purge stale jobs", { error: (err as Error).message });
  }

  // Backfill next_run_at for any active row where it's NULL. Older rows
  // (created before the engine started tracking this column) lack the value
  // and Rails' WakeSweepJob keys off of it, so without this they're invisible
  // to the wake sweep and their wake-from-sleep never fires.
  try {
    await host.backfillScheduledWorkNextRunAt(parseInt(config.employeeId));
  } catch (err) {
    logger.warn("Work scheduler: backfillScheduledWorkNextRunAt failed", { error: (err as Error).message });
  }

  await loadAndRegister();
  setInterval(loadAndRegister, POLL_INTERVAL_MS);
}

async function loadAndRegister(): Promise<void> {
  try {
    const items = await host.getScheduledWork(parseInt(config.employeeId));
    const currentIds = new Set(items.map((i) => i.id));

    // Remove BullMQ repeatable jobs for items that were deleted/paused.
    for (const prevId of registeredWorkIds) {
      if (!currentIds.has(prevId)) {
        await removeRepeatableJob(prevId).catch(() => {});
      }
    }

    for (const item of items) {
      await registerItem(item);
    }

    registeredWorkIds = currentIds;

    if (items.length > 0) {
      const summary = items.map((i) => `${i.mode}:${i.name}`).join(", ");
      logger.info(`Work scheduler: ${items.length} active item(s) — ${summary}`);
    }
  } catch (err) {
    logger.error("Work scheduler: failed to load", { error: (err as Error).message });
  }
}

async function registerItem(item: ScheduledWorkItem): Promise<void> {
  const jobType = item.mode === "interval" ? "heartbeat" : "scheduled_task";

  // Schedules carry the delivery channel in payload_extra so the agent's
  // final emitDone routes back to wherever the user originally set the
  // schedule (chat channel if created via set_reminder/schedule_task,
  // explicit dropdown value if created via the Schedule UI form).
  // Default "web" — the internal chat tab on the agent show page.
  const extra = (item.payload_extra || {}) as Record<string, unknown>;
  const channel = typeof extra.channel === "string" && extra.channel.length > 0
    ? (extra.channel as string)
    : "web";
  const channelMetadata = (extra.channelMeta as Record<string, unknown> | undefined) || {};

  const payload = {
    type: jobType as "heartbeat" | "scheduled_task",
    agentId: config.employeeId,
    orgId: undefined as number | undefined,
    channel,
    payload: {
      instruction: item.instruction,
      taskId: item.id,
      metadata: channelMetadata,
    },
  };

  switch (item.mode) {
    case "cron": {
      const tz = item.timezone || "UTC";

      // Backfill: if the previous expected tick passed while the engine was
      // asleep AND we haven't already serviced it, fire immediately. BullMQ's
      // repeat:{pattern} does NOT backfill missed ticks on its own — once a
      // tick passes with no worker, it's lost. Critical for "send X in 5 min"
      // intents on agents whose machines auto-stop when idle.
      try {
        const interval = CronExpressionParser.parse(item.cron_expression!, { tz, currentDate: new Date() });
        const prevDate = interval.prev().toDate();
        const prevMs = prevDate.getTime();
        const lastRunMs = item.last_run_at ? new Date(item.last_run_at).getTime() : 0;
        // Don't backfill ticks that happened before the schedule existed —
        // e.g. a "daily at 9am" schedule created at noon shouldn't fire as if
        // it ran this morning.
        const createdMs = item.created_at ? new Date(item.created_at).getTime() : 0;
        const ageMs = Date.now() - prevMs;
        if (ageMs >= 0 && ageMs <= CRON_BACKFILL_WINDOW_MS && prevMs > lastRunMs && prevMs >= createdMs) {
          await queue.add(jobType, payload, {
            jobId: `work-cron-${item.id}-backfill-${prevMs}`,
            removeOnComplete: { count: 5 },
        priority: 10, // scheduled work yields to user-originated jobs (priority 1)
            removeOnFail: { count: 3 },
          });
          logger.info(
            `Work scheduler: backfilled missed cron tick for #${item.id} (prev=${prevDate.toISOString()}, ${Math.round(ageMs / 1000)}s ago)`,
          );
        }
      } catch (err) {
        logger.warn(`Work scheduler: cron backfill check failed for #${item.id}`, { error: (err as Error).message });
      }

      await queue.add(jobType, payload, {
        repeat: { pattern: item.cron_expression!, tz },
        jobId: `work-cron-${item.id}`,
        removeOnComplete: { count: 5 },
        priority: 10, // scheduled work yields to user-originated jobs (priority 1)
        removeOnFail: { count: 3 },
      });
      break;
    }
    case "interval": {
      const everyMs = (item.interval_seconds ?? 1800) * 1000;
      await queue.add(jobType, payload, {
        repeat: { every: everyMs },
        jobId: `work-int-${item.id}`,
        removeOnComplete: { count: 10 },
        priority: 10, // scheduled work yields to user-originated jobs (priority 1)
        removeOnFail: { count: 5 },
      });
      break;
    }
    case "once": {
      if (!item.fire_at) break;
      // A one-shot fires exactly once. If it has already run at/after its
      // fire time, never re-register it — otherwise a past-due `once` row
      // that's still active (e.g. before its deactivation lands, or a legacy
      // row) gets re-fired on every 60s poll, looping indefinitely.
      const fireMs = new Date(item.fire_at).getTime();
      const lastRunMs = item.last_run_at ? new Date(item.last_run_at).getTime() : 0;
      if (lastRunMs >= fireMs) {
        logger.info(`Work scheduler: skipping already-serviced one-shot #${item.id} (last_run >= fire_at)`);
        break;
      }
      const delayMs = fireMs - Date.now();
      if (delayMs <= 0) {
        // Already past — fire immediately
        await queue.add(jobType, payload, {
          jobId: `work-once-${item.id}`,
          removeOnComplete: { count: 5 },
        priority: 10, // scheduled work yields to user-originated jobs (priority 1)
          removeOnFail: { count: 3 },
        });
      } else {
        await queue.add(jobType, payload, {
          delay: delayMs,
          jobId: `work-once-${item.id}`,
          removeOnComplete: { count: 5 },
        priority: 10, // scheduled work yields to user-originated jobs (priority 1)
          removeOnFail: { count: 3 },
        });
      }
      break;
    }
  }
}

async function removeRepeatableJob(workId: number): Promise<void> {
  // BullMQ's removeRepeatable needs the exact job options. Instead, look
  // for the job by its custom jobId prefix and remove it.
  const repeatables = await queue.getRepeatableJobs();
  for (const r of repeatables) {
    const key = r.key || "";
    if (key.includes(`work-cron-${workId}`) || key.includes(`work-int-${workId}`)) {
      await queue.removeRepeatableByKey(key);
      logger.info(`Work scheduler: removed repeatable job for work #${workId}`);
    }
  }
  // For one-shot jobs that haven't fired yet, remove by jobId
  const job = await queue.getJob(`work-once-${workId}`);
  if (job) {
    await job.remove();
    logger.info(`Work scheduler: removed one-shot job for work #${workId}`);
  }
}
