// Scale-to-zero, engine half. After IDLE_STOP_MINUTES with no work, the
// engine reports itself asleep to Rails and exits 0. The Fly machine's
// restart policy is on-failure, so a clean exit stops the machine — cost
// drops to the volume. Rails wakes it (AgentWaker / WakeSweepJob) the
// moment new work is queued; queues live in Redis, so nothing is lost
// while asleep.
//
// "Idle" is strict — ALL must hold:
//   • no BullMQ job active/waiting/prioritized (delayed excluded: those
//     are future repeatable ticks that Rails wakes us for)
//   • the Redis inbox list is empty
//   • no in-run approval waiter (a paused request_approval turn)
//   • nothing touched touch() within the window (jobs, WS traffic,
//     channel inbounds)
//
// Heartbeat-enabled agents never self-stop — their interval ticks fire
// engine-side and sleeping would silently kill them.

import { config } from "./config.js";
import { redis, queue } from "./queue.js";
import { getPendingActionApprovals } from "./security/action-approval.js";
import { logger, flushLogs } from "./logger.js";

const IDLE_STOP_MINUTES = Number(process.env.IDLE_STOP_MINUTES || "0");
const CHECK_EVERY_MS = 60 * 1000;

let lastActivity = Date.now();
let checker: ReturnType<typeof setInterval> | null = null;
let stopping = false;

// Call from anywhere work happens: job start/finish, WS message, channel
// inbound. Cheap enough to sprinkle liberally.
export function touch(): void {
  lastActivity = Date.now();
}

export function startIdleStop(opts: {
  heartbeatEnabled: boolean;
  onSleep: () => Promise<void>;
}): void {
  if (!IDLE_STOP_MINUTES || IDLE_STOP_MINUTES <= 0) {
    logger.info("Idle-stop disabled (IDLE_STOP_MINUTES unset/0)");
    return;
  }
  if (opts.heartbeatEnabled) {
    logger.info("Idle-stop disabled: heartbeats are engine-driven — sleeping would kill them");
    return;
  }

  logger.info(`Idle-stop armed: sleeping after ${IDLE_STOP_MINUTES}m of no work`);
  checker = setInterval(async () => {
    if (stopping) return;
    const idleMs = Date.now() - lastActivity;
    if (idleMs < IDLE_STOP_MINUTES * 60 * 1000) return;

    try {
      const counts = await queue.getJobCounts("active", "waiting", "prioritized");
      if ((counts.active || 0) + (counts.waiting || 0) + (counts.prioritized || 0) > 0) {
        touch(); // queued work counts as activity — re-arm the window
        return;
      }
      const inboxLen = await redis.llen(`agent-inbox-${config.employeeId}`);
      if (inboxLen > 0) {
        touch();
        return;
      }
      if (getPendingActionApprovals().length > 0) {
        // A run is paused on request_approval — the decision resolves via
        // pub/sub which needs us alive. (The durable inbox fallback only
        // covers decisions made AFTER we sleep.)
        touch();
        return;
      }
    } catch (err) {
      logger.warn("Idle-stop check failed — staying up", { error: (err as Error).message });
      return;
    }

    stopping = true;
    if (checker) clearInterval(checker);
    logger.info(`Idle for ${Math.round(idleMs / 60000)}m — going to sleep (machine will stop)`);
    try {
      await reportAsleep();
      await opts.onSleep();
    } catch (err) {
      logger.error("Sleep shutdown hit an error — exiting anyway", { error: (err as Error).message });
    }
    await flushLogs();
    process.exit(0);
  }, CHECK_EVERY_MS);
}

async function reportAsleep(): Promise<void> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  if (!rails || !secret) return;
  const res = await fetch(`${rails}/api/agent_instances/asleep`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Engine-Secret": secret },
    body: JSON.stringify({ employee_id: config.employeeId }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`asleep report → HTTP ${res.status}`);
  logger.info("Reported sleeping to Rails");
}
