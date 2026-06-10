---
name: instantly-outreach
description: Send warm outbound through Instantly — campaigns, lead upload, warmup health checks, reply handling. Use for anything involving sending, scheduling, or monitoring outbound email.
---

# Instantly outreach

All outbound email goes through Instantly. Never send cold email from the
primary mailbox directly — Instantly's rotated, warmed inboxes protect
deliverability.

## Warmup gate (always first)

Before adding leads or activating anything:

1. `list_accounts` — list sending inboxes attached to the workspace.
2. `get_warmup_analytics` — check each inbox's warmup score.
3. **Only use inboxes with warmup score ≥ 90.** If none qualify, stop and
   report — do not send through cold inboxes.

## Campaign workflow

1. `create_lead_list` + `add_leads_to_campaign_or_list_bulk` — upload the
   approved, enriched leads (≤50 per batch, per the approval rules).
2. `verify_email` any lead whose verification is stale.
3. `create_campaign` — 3-step sequence (day 0 / day 3 / day 8), weekdays
   only, prospect-timezone sending window 8am–5pm. Personalization
   variables come from the enrichment table; every product claim traces
   to the pitch deck.
4. `activate_campaign` — only after the human has approved the batch
   (`cold_email_bulk: ask`).
5. Monitor: `get_campaign_analytics` daily. If positive-reply rate < 2%
   after 100 sends, `pause_campaign` and report rather than pushing
   volume.

## Replies

- `list_emails` / `count_unread_emails` each working session; never let a
  reply sit > 4 business hours.
- Positive replies: move the conversation to qualification, then booking
  (`reply_to_email` is allowed without approval inside an existing
  thread).
- Opt-outs: `update_lead` to suppress immediately, confirm suppression in
  the same session, never contact again.
- `mark_thread_as_read` after handling so the unread count stays
  meaningful.
