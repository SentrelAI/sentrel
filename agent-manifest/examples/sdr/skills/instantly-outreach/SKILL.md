---
name: instantly-outreach
description: Send warm outbound through Instantly — campaigns, lead upload, warmup health checks, reply handling. Use for anything involving sending, scheduling, or monitoring outbound email.
---

# Instantly outreach

All outbound email goes through Instantly. Never send cold email from the
primary mailbox directly — Instantly's rotated, warmed inboxes protect
deliverability.

Call the Instantly v2 REST API with the **`request`** tool (server `apps`):

```
request({ provider: "instantly", method, path, query?, body? })
```

- **Base is `https://api.instantly.ai`** — give `path` relative,
  starting with `/` (e.g. `/api/v2/campaigns`).
- **Auth is injected for you.** Instantly uses an API key; it's added as
  the `Authorization: Bearer …` header automatically. NEVER ask for,
  include, or echo a key.
- **Instantly has no Nango template** — it's a paste-token integration.
  Connect it once at /integrations by pasting the workspace API key
  before the agent runs. A 401 here means it isn't connected yet.
- List endpoints are `GET` with `query`; create/update are `POST`/`PATCH`
  with a JSON `body`. Lists paginate via `limit` + `starting_after`.

## Warmup gate (always first)

Before adding leads or activating anything:

1. `GET /api/v2/accounts` — list sending inboxes in the workspace.
2. `GET /api/v2/accounts/warmup-analytics` (or read each account's
   warmup fields) — check each inbox's warmup score.
3. **Only use inboxes with warmup score ≥ 90.** If none qualify, stop and
   report — do not send through cold inboxes.

## Campaign workflow

1. **Upload approved leads** — `POST /api/v2/leads` per lead, or use the
   bulk leads endpoint, attaching `campaign:"<campaign_id>"`. Stay ≤ 50
   leads per batch, per the approval rules. Personalization variables
   ride along in the lead's `custom_variables` from the enrichment table.
2. **Create the campaign** — `POST /api/v2/campaigns` with a 3-step
   sequence (day 0 / day 3 / day 8), weekdays only, prospect-timezone
   sending window 8am–5pm. Every product claim traces to the pitch deck.
3. **Activate** — `POST /api/v2/campaigns/{id}/activate` only after the
   human has approved the batch (`cold_email_bulk: ask`).
4. **Monitor** — `GET /api/v2/campaigns/analytics` (scoped by campaign
   id) daily. If positive-reply rate < 2% after 100 sends,
   `POST /api/v2/campaigns/{id}/pause` and report rather than push volume.

## Replies

- `GET /api/v2/emails` (filtered to unread/inbound) each working session;
  never let a reply sit > 4 business hours.
- Positive replies: move the conversation to qualification, then booking.
  Replying inside an existing thread (`POST /api/v2/emails/reply`) is
  allowed without approval (`reply_email: auto`).
- Opt-outs: `PATCH /api/v2/leads/{id}` to mark unsubscribed / add to the
  block list immediately, confirm suppression in the same session, never
  contact again.
- Mark threads read after handling so the unread count stays meaningful.

## Rules

- One Instantly `request(...)` at a time; don't fan out parallel calls.
- Check for an existing contact before any send — one thread per prospect,
  no double-touching.
- Endpoint shapes drift between Instantly API versions; if a call 404s,
  re-check the path against the current v2 docs rather than guessing.

## Errors — what to do

| Status | Do |
|---|---|
| 401 | Not connected / bad key — tell the user to paste the Instantly API key at /integrations. Don't retry. |
| 403 | Plan or scope can't do this action — surface the message, don't loop. |
| 422 | Validation failed — read the message, fix the arg or ask. Don't resend the same body. |
| 429 | Rate limited — stop, back off, retry sequentially. |
