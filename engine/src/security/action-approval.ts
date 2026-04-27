// Generic action-approval primitive — same Promise-pause pattern as
// command-approval.ts but for arbitrary user-facing actions an agent might
// want a human to sign off on (publish a post, send a campaign, spend > $X).
//
// Lifecycle:
//   1. request_approval tool call → createActionApproval() → Promise pauses
//      the agent's turn (the tool result is the user's eventual decision).
//   2. Engine POSTs the approval to Rails (which renders it in the UI and
//      delivers to the user channel via the existing channel renderers).
//   3. User taps a button (Telegram inline keyboard) OR clicks a button on
//      the web /pending_approvals page → Rails publishes to Redis pub/sub.
//   4. Engine subscribes to its own approval channel (already wired for
//      command approvals); resolveActionApproval() fires the promise.

import { logger } from "../logger.js";

export interface ActionApprovalDecision {
  // The `value` the user picked from the options array. "approve" / "reject"
  // for default options; arbitrary strings (e.g. "edit") for custom flows.
  value: string;
  // Free-text amendment when the user picked an "edit"-like option. Empty
  // for plain approve/reject.
  text?: string;
}

interface PendingActionApproval {
  resolve: (decision: ActionApprovalDecision) => void;
  summary: string;
  payloadType: string;
  createdAt: number;
}

const pending = new Map<string, PendingActionApproval>();
let nextId = 1;

export function createActionApproval(
  summary: string,
  payloadType: string,
  timeoutMs = 24 * 60 * 60 * 1000, // 24h default — long enough for async user
): { id: string; promise: Promise<ActionApprovalDecision> } {
  const id = `act_${nextId++}`;

  const promise = new Promise<ActionApprovalDecision>((resolve) => {
    pending.set(id, { resolve, summary, payloadType, createdAt: Date.now() });

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ value: "timeout" });
        logger.warn(`Action approval ${id} timed out, auto-resolving as 'timeout'`);
      }
    }, timeoutMs);
  });

  return { id, promise };
}

export function resolveActionApproval(id: string, decision: ActionApprovalDecision): boolean {
  const p = pending.get(id);
  if (!p) return false;
  p.resolve(decision);
  pending.delete(id);
  logger.info(`Action approval ${id} resolved: ${decision.value} (${p.payloadType})`);
  return true;
}

export function getPendingActionApprovals(): Array<{ id: string; summary: string; payloadType: string }> {
  return Array.from(pending.entries()).map(([id, p]) => ({
    id, summary: p.summary, payloadType: p.payloadType,
  }));
}
