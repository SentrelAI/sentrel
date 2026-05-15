# Alchemy

> **AI employees that live inside the tools your team already uses.**
> An agent platform — not a chatbot wrapper.

[![Build engine image](https://github.com/ParseDev/alchemy/actions/workflows/engine-image.yml/badge.svg)](https://github.com/ParseDev/alchemy/actions/workflows/engine-image.yml)
[![app-deploy](https://github.com/ParseDev/alchemy/actions/workflows/app-deploy.yml/badge.svg)](https://github.com/ParseDev/alchemy/actions/workflows/app-deploy.yml)
[![CI](https://github.com/ParseDev/alchemy/actions/workflows/ci.yml/badge.svg)](https://github.com/ParseDev/alchemy/actions/workflows/ci.yml)

---

## What is this?

Most "AI agents" today are a single chatbot dressed in different system prompts. Alchemy is the opposite: every agent is a **real teammate** with its own identity, its own runtime, its own logins to Slack / Gmail / your CRM, and its own dedicated channel where humans talk to it.

- **One process per agent.** Each agent runs in its own Fly Machine. No shared memory, no shared bot identity. Sarah's context never leaks into Casper's.
- **Real OAuth, not scrapers.** Native integrations with 250+ tools through Composio + dedicated channel apps (Slack, Gmail, Telegram, WhatsApp).
- **Policy-gated.** Per-action approval policies — auto-send routine email, draft refunds, never delete data. Set once at the team level.
- **Model-agnostic.** Claude, GPT, Gemini, OpenRouter. Mix per-agent.
- **Replayable.** Every tool call, every decision, every $ spent — searchable timeline with full traces.

Built by [Elie Toubiana](https://github.com/eltoubia) (CEO) and [Abdelmoumin Mokhtari](https://github.com/qubitam) (Head of Engineering) at ScribeMD because we needed it ourselves.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                  alchemy.scribemd.ai  (Rails control plane)        │
│                                                                    │
│  - Auth / orgs / agents / policies / approvals / templates         │
│  - Inertia + React UI                                              │
│  - SES inbound + outbound · Slack OAuth · webhook gateway          │
│  - Audit logs · run traces · cost tracking                         │
└─────────────┬──────────────────────────────────────────────────────┘
              │  Redis pub/sub  +  /api/* (X-Engine-Secret)
              │
   ┌──────────┴───────────┬──────────────────┬─────────────────┐
   ▼                      ▼                  ▼                 ▼
┌────────┐            ┌────────┐         ┌────────┐        ┌────────┐
│ Sarah  │            │ Casper │         │ Jamie  │        │  ...   │
│  SDR   │            │  CoS   │         │   CX   │        │        │
│        │            │        │         │        │        │        │
│  Fly   │            │  Fly   │         │  Fly   │        │  Fly   │
│Machine │            │Machine │         │Machine │        │Machine │
└────────┘            └────────┘         └────────┘        └────────┘
   bun + Claude Agent SDK + per-agent /data volume + BullMQ inbox
```

The Rails app is the **control plane** — auth, policy, billing, audit trail. The engine is the **agent runtime** — one isolated Fly Machine per agent, running Bun + the Claude Agent SDK + the per-agent toolset. They communicate over Redis pub/sub (for sync + inbox) and HTTPS (`engine → Rails /api/*`).

This isolation matters: when Casper hits an OAuth token revocation, Sarah keeps running. When Jamie's prompt grows to 80 KB, it doesn't slow down anyone else's turn. Costs are tracked per agent. Engines roll independently.

---

## Repo layout

```
alchemy/
├── backend/              # Rails 8 + Inertia/React control plane
│   ├── app/              #   controllers, models, frontend (TSX), services
│   ├── config/deploy.yml #   kamal target — EC2 host
│   ├── .kamal/           #   deploy config + secrets (gitignored)
│   └── Dockerfile        #   web image
│
├── engine/               # TypeScript per-agent runtime
│   ├── src/              #   agent-runner, MCP tools, channels, RAG
│   ├── Dockerfile        #   bun + Claude Agent SDK image
│   └── fly.toml          #   per-agent Fly app template
│
├── bin/
│   ├── setup             # installs both halves
│   └── dev               # boots Rails + Vite + Sidekiq + engine
│
├── .github/workflows/
│   ├── engine-image.yml  # build + push engine image to GHCR
│   ├── app-deploy.yml    # kamal deploy on push to main
│   └── ci.yml            # rubocop + brakeman + tests
│
└── docs/                 # architecture + operations notes
```

---

## Quick start

```bash
git clone git@github.com:ParseDev/alchemy.git
cd alchemy

bin/setup    # installs gems + npm + bun deps for both halves
bin/dev      # foreman: vite + rails + sidekiq + engine
```

Prerequisites:
- **Ruby** — see `backend/.ruby-version` (3.4.x)
- **Node 20+** + **npm** — for the Vite frontend build
- **[Bun](https://bun.sh)** 1.1+ — engine runtime
- **Postgres 16+** + **Redis 7+** — locally or via Docker

Visit `http://localhost:3200` once everything's up.

---

## Deploy

Both halves deploy independently and roll forward without coordination.

**Rails control plane** — push to `main` with changes under `backend/**` triggers `app-deploy.yml`. The workflow builds + pushes the Rails image to GHCR, then SSH's into the EC2 host and runs `kamal deploy` + `db:migrate`. Live at <https://alchemy.scribemd.ai>.

**Per-agent engine** — push to `main` with changes under `engine/**` triggers `engine-image.yml`. The workflow builds a multi-arch image and pushes `ghcr.io/parsedev/alchemy-engine:latest`. Each agent's Fly Machine pulls the new image on its next cold-boot (usually within 5 minutes since machines auto-stop when idle).

Manual triggers: both workflows have `workflow_dispatch` in the Actions tab.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Rails 8 + Inertia.js + React 19 | Server-driven router; no API duplication; speed of Rails generators with React DX |
| ORM | Active Record + Postgres 16 | acts_as_tenant + PrefixedIds for multi-org safety |
| Background jobs | Sidekiq + sidekiq-cron | Wake sweeps, schedule rolls, OAuth refreshes |
| Agent runtime | Bun + Claude Agent SDK | Fast cold-start, native TypeScript, first-class MCP tool support |
| Agent hosting | Fly Machines (per-agent VM) | Auto-start on inbound, /data volume for memory, 25+ regions |
| Queues | BullMQ on Redis | Delayed jobs, cron, retries for agent inbox |
| Integrations | Composio + custom OAuth | 250+ apps via Composio, native Slack channel app, SES email |
| Models | Anthropic / OpenAI / OpenRouter | Per-agent model selection, BYO API keys |
| Deploy | kamal (Rails) + Fly Machines API (engine) | Single EC2 for the control plane, fleet of micro-VMs for agents |
| Auth | Devise + per-agent OAuth credentials | Org-scoped users + per-agent Slack / Gmail / Telegram tokens |

---

## Documentation

| Document | What's inside |
|---|---|
| [`docs/deploy.md`](docs/deploy.md) | Production deploy walkthrough |
| [`docs/per-agent-hosting.md`](docs/per-agent-hosting.md) | How each agent gets its own Fly Machine |
| [`docs/integrations.md`](docs/integrations.md) | Composio + native OAuth integrations |
| [`docs/slack-integration-plan.md`](docs/slack-integration-plan.md) | Slack channel-per-agent design |
| [`docs/monorepo-merge.md`](docs/monorepo-merge.md) | How the two repos became one |
| [`docs/testing-checklist.md`](docs/testing-checklist.md) | Pre-release smoke tests |
| [`docs/fly-aws-bridge.md`](docs/fly-aws-bridge.md) | Engine ↔ Rails network bridge |

---

## Status

**In early access.** Production at <https://alchemy.scribemd.ai> with a handful of users. Core surface stable; rough edges in places, plenty of [todo's](ROADMAP.md). If you're early-team material and want to break something on purpose, reach out.

---

## License

Source-available under a custom license — see [`LICENSE`](LICENSE) (TBD). Production use by ScribeMD; external use case-by-case for now.

---

<sub>Made with attention to detail and a slightly unreasonable amount of caffeine, in Algiers and Paris.</sub>
