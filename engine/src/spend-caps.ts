// Per-agent spend caps. Rails owns the source of truth — the engine just
// asks before each run whether it's allowed to proceed and whether it
// should post the "approaching cap" heads-up. Best-effort on network
// blip: callers fall back to running unrestricted when the check fails.

import { logger } from "./logger.js";

export interface SpendCapState {
  daily_cap_usd: number | null;
  monthly_cap_usd: number | null;
  notify_threshold_pct: number;
  notified_today: boolean;
  spend_today_usd: number;
  spend_month_usd: number;
  over_daily: boolean;
  over_monthly: boolean;
  should_notify: boolean;
}

export async function checkSpendCap(agentId: number): Promise<SpendCapState | null> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  if (!rails || !secret) {
    logger.warn("spend cap check skipped — RAILS_INTERNAL_URL or ENGINE_API_SECRET unset");
    return null;
  }
  // Retry transient failures so a single network blip doesn't silently open
  // the gate. Callers fail-closed for autonomous jobs on a null result, so a
  // false negative here can halt scheduled work — worth a couple of retries.
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${rails}/api/spend_caps/check?agent_id=${agentId}`, {
        headers: { "X-Engine-Secret": secret },
        signal: AbortSignal.timeout(2_500),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      return (await res.json()) as SpendCapState;
    } catch (err) {
      lastErr = (err as Error).message;
    }
  }
  logger.warn("spend cap check failed after retries", { error: lastErr });
  return null;
}

export async function markSpendNotified(agentId: number): Promise<void> {
  const rails = process.env.RAILS_INTERNAL_URL;
  const secret = process.env.ENGINE_API_SECRET;
  if (!rails || !secret) return;
  try {
    await fetch(`${rails}/api/spend_caps/mark_notified?agent_id=${agentId}`, {
      method: "POST",
      headers: { "X-Engine-Secret": secret },
      signal: AbortSignal.timeout(2_500),
    });
  } catch { /* best effort */ }
}
