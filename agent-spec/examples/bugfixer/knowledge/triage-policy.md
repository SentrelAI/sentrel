# Triage policy

This file is the contract for what {{agent_name}} may fix autonomously.
Edit it to widen or narrow the mandate — the persona doesn't change.

## Severity rubric

| Tier | Signal | Response time |
|------|--------|---------------|
| P0   | Sentry issue spiking (>100 events/hr) or marked critical | Same sweep — analyze immediately, escalate if not auto-fixable |
| P1   | Recurring production error (daily occurrences) or Linear `bug` + `urgent` | Within one working day |
| P2   | Steady low-volume error, or plain `bug` ticket | Within three working days |
| P3   | Cosmetic, log-noise, flaky-test tickets | Batch into the Friday digest; fix opportunistically |

## Auto-fixable (open a PR)

Small, locally-verifiable mistakes where the stack trace points at the
exact line and the fix is mechanical:

- Nil/undefined guards where the invariant is clear from surrounding code
- Off-by-one and boundary errors in display/pagination logic
- Wrong or missing imports, typo'd identifiers, dead references
- Incorrect string formatting, broken interpolations, encoding slips
- Missing translations or hardcoded copy the codebase already centralizes
- Stale config defaults that drifted from documented values
- Obvious wrong-operator bugs (`&&`/`||`, `<`/`<=`) with clear intent

## Analyze-only (comment, never PR) — regardless of diff size

- Authentication, authorization, sessions, permissions
- Payments, billing, invoicing, anything money-adjacent
- Database migrations or schema changes
- Concurrency: locks, race conditions, background-job ordering
- Data deletion or destructive backfills
- Secrets, keys, tokens, environment configuration
- Anything where the root cause spans more than ~3 files
- Anything you could not explain to a reviewer in four sentences

## PR conventions

- Branch: `fix/<id>-<slug>` (e.g. `fix/lin-567-nil-user-email`)
- Title: `Fix: <symptom> (<LIN-567 / SENTRY-ABC>)`
- Description sections: **Root cause** (2-4 sentences, quote the frame),
  **Fix** (what changed and why it's minimal), **Evidence** (links),
  **Out of scope** (what you deliberately did not touch).
- Target the repository's default branch as base. Never force-push.

## Repos

Your repositories: {{github_repos}}

Work ONLY in this list. A stack trace pointing at any other repository
is escalate-only, even when the GitHub connection has access. If a
listed repo turns out to be unreadable, escalate — never guess at code
you cannot see.
