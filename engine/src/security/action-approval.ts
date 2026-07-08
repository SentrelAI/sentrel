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

import { randomUUID } from "crypto";
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

// How long a run blocks in-line waiting for the human. Short on purpose:
// past this the tool returns { value: "pending" }, the agent tells the user
// it's waiting and ENDS the turn — freeing the (concurrency-1) lane for chat.
// The approval card stays live; when the decision lands with no in-run waiter,
// the gateway enqueues a continuation job (see gateway.ts approval sub).
// Before this, the wait defaulted to 24h — runs showed "Thinking · 1440m" and
// every queued message sat behind them.
export const IN_RUN_APPROVAL_WAIT_MS = 2 * 60 * 1000;

export function createActionApproval(
  summary: string,
  payloadType: string,
  timeoutMs = IN_RUN_APPROVAL_WAIT_MS,
): { id: string; promise: Promise<ActionApprovalDecision> } {
  // Globally-unique token: a per-process counter would reset on engine restart
  // and collide with prior approvals already in pending_approvals (UNIQUE
  // index on approval_token) → "duplicate-token constraint" on the next create.
  const id = `act_${randomUUID()}`;

  const promise = new Promise<ActionApprovalDecision>((resolve) => {
    pending.set(id, { resolve, summary, payloadType, createdAt: Date.now() });

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        // "pending" ≠ rejected: the card is still live in the UI. The tool
        // handler tells the agent to end its turn; the decision resumes work
        // via a continuation job when it eventually arrives.
        resolve({ value: "pending" });
        logger.info(`Action approval ${id}: no decision within in-run wait — releasing the turn (card stays active)`);
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
