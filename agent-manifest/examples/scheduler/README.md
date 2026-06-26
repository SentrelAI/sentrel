# Scheduler example bundle — "Rio"

An executive-grade scheduling assistant as an Agent Bundle. The
interesting part isn't the booking — it's the **lifecycle**: every
thread moves through an explicit state machine with self-scheduled
follow-up checks, a hard two-follow-up cap, and a memory ledger so
nothing stays half-scheduled.

```
scheduler/
├── agent.yaml                       # manifest — goal, wiring, permissions
├── identity.md                      # who Rio is, what he refuses to do
├── personality.md                   # EA voice, follow-up tone, anti-patterns
├── instructions.md                  # hard rules + the thread lifecycle
├── knowledge/
│   └── scheduling-policy.md         # hours, defaults, cadence, office — edit HERE
└── skills/
    └── follow-up-protocol/          # the propose → nudge ×2 → cold machine
```

## The state machine

```
REQUESTED → PROPOSED → (reply) → BOOKED
                │
                ├─ day 2, silent → FOLLOW-UP 1 (slots refreshed)
                ├─ day 4, silent → FOLLOW-UP 2 (last one, easy out)
                └─ day 6, silent → COLD — owner flagged, thread closed
```

Follow-up checks are **self-scheduled reminders**: after proposing, Rio
books a check for +2 business days carrying the thread context. When it
fires he either handles the reply, sends the next (slot-refreshed)
follow-up, or — after two unanswered nudges — flags the thread cold to
the owner and goes quiet. The cap is an invariant, not a suggestion.

## What it demonstrates

| Requirement | Where |
| --- | --- |
| 9–5 only, end-time inclusive | `knowledge/scheduling-policy.md` + hard rule 1 |
| Never double-book (re-check at booking) | hard rule 2 |
| Meet link default / in-person travel blocks | hard rules 6–7 |
| Descriptive names, 30-min default, 3 slots | hard rules 3, 4, 8 |
| Everyone in the thread invited, no guessed emails | hard rule 5 |
| Owner CC'd on every outbound email | hard rule 9 + policy doc |
| Follow-up after 2 days, max twice, then cold | `skills/follow-up-protocol` |
| Reschedule / cancel / decline / OOO / revival | instructions + skill edge cases |
| Day-before RSVP confirmation | instructions |
| Auditable state | the memory ledger format |
| Standing cron jobs from day one | `schedules:` in agent.yaml — morning sweep (weekdays 8:30) + Friday pipeline digest |

## Safety posture

- `book_meeting: auto` / `reply_email: auto` — momentum where it's safe
- `send_email: ask` — NEW outbound threads need approval
- `cancel_meeting: ask` — cancellations confirm with the owner first
- `delete_data: block`

## Deploy it

```sh
npx @manifestagent/agentmanifest deploy examples/scheduler
```

This validates the bundle, uploads it, and opens the sentrel deploy
wizard in your browser. Or from a workspace:
`/deploy-agent?source=<this repo URL>/tree/main/agent-manifest/examples/scheduler`

After deploy: connect Google Calendar + Gmail (the wizard offers both —
the `google-calendar` and `google-mail` connections), fill the office
address in the policy knowledge doc (or let Rio ask once), and send a
test: "book a 30-min intro with someone@example.com next week" — expect
exactly 3 slots and a follow-up check on the books.

Rio reaches every connected app through one tool, `request` (server
`apps`): `request({ provider, method, path, query?, body? })`. The
platform injects auth and returns `{ status, body }` — no SDKs and no
credentials live in the bundle. The bundled `calendar-booking` and
`gmail-management` skills carry the exact request shapes.
