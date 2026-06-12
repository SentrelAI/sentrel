---
name: follow-up-protocol
description: Use when proposing meeting slots, when a follow-up reminder fires, or when a reply arrives on a scheduling thread. Drives the propose → follow-up ×2 → cold state machine with self-scheduled reminder checks.
---

# Follow-up protocol

The mechanic that makes the scheduler relentless without being annoying:
every proposal sets a self-addressed reminder; every reminder firing
decides ONE of four actions; two unanswered follow-ups end the chase.

## Scheduling the check

Immediately after sending slot proposals in a thread, create a one-time
scheduled task (reminder) for **+2 business days**, addressed to myself,
with an instruction that carries everything future-me needs:

```
Follow-up check: thread with <requester name + email> about "<topic>".
Proposed on <date>: <slot 1>, <slot 2>, <slot 3>. follow_up_count=<n>.
Check the thread for replies and apply the follow-up protocol.
```

Business days: skip Saturday/Sunday. Proposal sent Thursday → check
fires Monday.

## When the reminder fires — exactly one of four actions

1. **Thread has a reply I haven't handled** → handle the reply (book /
   re-propose / close). Cancel any other pending reminders for this
   thread. The follow-up cycle is over.

2. **No reply, follow_up_count = 0** → send follow-up #1:
   - FIRST re-check the calendar. Any proposed slot now taken or in the
     past → replace it. The follow-up always contains 3 currently-valid
     slots.
   - One short paragraph + the slots. No "circling back".
   - Update the ledger (fu:1), schedule the next check (+2 business days).

3. **No reply, follow_up_count = 1** → send follow-up #2, the FINAL one:
   - Same freshness check on slots.
   - Include the easy out: "If now's not the right time, no problem —
     tell me and I'll close this out."
   - Update the ledger (fu:2), schedule one last check (+2 business days).

4. **No reply, follow_up_count = 2** → send NOTHING to the requester.
   - Mark the thread COLD in the ledger.
   - One-line heads-up to {{user_name}}: "<Name> (<company>) never
     replied about <topic> — proposed <date>, followed up twice, marking
     cold."
   - Cancel any remaining reminders for the thread. Done.

## When a reply arrives outside a reminder

Same protocol, just earlier: handle the reply, cancel the thread's
pending reminders, update the ledger. A reply RESETS nothing unless it
asks for new times — "send me other options" → fresh 3 slots,
follow_up_count back to 0, new check scheduled.

## Edge cases

- **Out-of-office auto-reply** → not a real reply. Don't increment
  anything; if the OOO gives a return date after my next check, push the
  check to the day after their return.
- **Reply from someone else in the thread** (assistant, colleague) → a
  real reply. Continue with them; keep everyone on the eventual invite.
- **Requester replies after COLD** → revive: fresh slots,
  follow_up_count back to 0, tell {{user_name}} the thread woke up.
- **Multiple parallel threads with the same person** → each thread has
  its own ledger entry and its own reminder chain. Never merge counts.

## Invariants (check before every send)

- follow_up_count never exceeds 2.
- Never two follow-ups inside the same 24h.
- Every follow-up contains exactly 3 currently-valid slots.
- Every send CC's {{user_name}} (unless already on the thread's To/CC).
- Every state change lands in the ledger before I do anything else.
