// Phase S — Real-time command approval via Telegram/WhatsApp buttons
//
// When the PreToolUse hook detects a dangerous command, it pauses the
// agent's execution, sends the user buttons (Once/Session/Always/Deny),
// and waits for their decision before allowing or blocking the command.

import { logger } from "../logger.js";

export type ApprovalLevel = "once" | "session" | "always" | "deny";

interface PendingCommandApproval {
  resolve: (level: ApprovalLevel) => void;
  command: string;
  category: string;
  createdAt: number;
}

// Map of approval ID → pending Promise resolver
// The PreToolUse hook creates an entry, the Telegram callback resolves it
const pendingApprovals = new Map<string, PendingCommandApproval>();

let nextId = 1;

// Create a pending approval and return a Promise that resolves when
// the user taps a button. Called from the PreToolUse hook.
export function createCommandApproval(
  command: string,
  category: string,
): { id: string; promise: Promise<ApprovalLevel> } {
  const id = `cmd_${nextId++}`;

  const promise = new Promise<ApprovalLevel>((resolve) => {
    pendingApprovals.set(id, {
      resolve,
      command,
      category,
      createdAt: Date.now(),
    });

    // Auto-deny after 60 seconds if no response
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        resolve("deny");
        logger.warn(`Command approval ${id} timed out (60s), auto-denied`);
      }
    }, 60_000);
  });

  return { id, promise };
}

// Resolve a pending approval. Called from the Telegram callback handler
// when the user taps a button.
export function resolveCommandApproval(id: string, level: ApprovalLevel): boolean {
  const pending = pendingApprovals.get(id);
  if (!pending) return false;

  pending.resolve(level);
  pendingApprovals.delete(id);
  logger.info(`Command approval ${id} resolved: ${level} (${pending.category})`);
  return true;
}

// Check if there's a pending approval (for debugging)
export function hasPendingApproval(id: string): boolean {
  return pendingApprovals.has(id);
}

// Get all pending approvals — used by gateway to re-broadcast to new clients
export function getPendingApprovals(): Array<{ id: string; command: string; category: string }> {
  return Array.from(pendingApprovals.entries()).map(([id, p]) => ({
    id,
    command: p.command,
    category: p.category,
  }));
}
