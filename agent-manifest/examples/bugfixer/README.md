# Patch — bug-fix engineer bundle

An agent-bundle/v1 that triages Sentry errors and Linear bug tickets,
ships small fixes as GitHub pull requests, and writes root-cause
analyses for anything too risky to auto-fix.

## What it does

- **Weekday triage sweep** (cron, 09:00 UTC): pulls new/escalating
  Sentry issues and `bug`-labeled Linear tickets, triages each into
  fix-PR / analyze-only / escalate per the triage policy.
- **Fixes via the GitHub API**: branch → commit → PR. Hard limits:
  ≤3 files, ~80 lines, never the default branch, never merges.
- **Closes the loop**: PR links land on the Linear ticket, Sentry
  issues get marked as addressed, reviews get reworked on the same
  branch, and a Friday digest summarizes the week.

## Deploy

```
https://sentrel.ai/deploy-agent?source=<github-url-to-this-folder>
```

GitHub is `required: true` — the wizard blocks deploy until it's
connected (a bug-fixer that can't open PRs is useless). Sentry and
Linear are optional at deploy but the agent is blind/mute without them.

## Customize

- `knowledge/triage-policy.md` — the mandate: what's auto-fixable,
  severity tiers, PR conventions. Edit this, not the persona.
- `agent.yaml` schedules — sweep cadence and digest timing.
- `permissions` — `create_pr` defaults to `auto` (PRs are reviewable
  by design); set it to `ask` for a draft-everything rollout.
