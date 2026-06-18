# Sentrel

> **AI employees that live inside the tools your team already uses.**
> An agent platform — not a chatbot wrapper.

[![Build engine image](https://github.com/ParseDev/double.md/actions/workflows/engine-image.yml/badge.svg)](https://github.com/ParseDev/double.md/actions/workflows/engine-image.yml)
[![app-deploy](https://github.com/ParseDev/double.md/actions/workflows/app-deploy.yml/badge.svg)](https://github.com/ParseDev/double.md/actions/workflows/app-deploy.yml)
[![CI](https://github.com/ParseDev/double.md/actions/workflows/ci.yml/badge.svg)](https://github.com/ParseDev/double.md/actions/workflows/ci.yml)

---

## What is this?

Most "AI agents" today are a single chatbot dressed in different system prompts. Sentrel is the opposite: every agent is a **real teammate** with its own identity, its own runtime, its own logins to Slack / Gmail / your CRM, and its own dedicated channel where humans talk to it.

- **One process per agent.** Each agent runs in its own Fly Machine. No shared memory, no shared bot identity. Sarah's context never leaks into Casper's.
- **Real OAuth, not scrapers.** Native integrations with 250+ tools through Composio + dedicated channel apps (Slack, Gmail, Telegram, WhatsApp).
- **Policy-gated.** Per-action approval policies — auto-send routine email, draft refunds, never delete data. Set once at the team level.
- **Model-agnostic.** Claude, GPT, Gemini, OpenRouter. Mix per-agent.
- **Replayable.** Every tool call, every decision, every $ spent — searchable timeline with full traces.

---

## A concrete example

Hire an SDR named Sarah. From `/agents/new`:

```
Name        Sarah
Role        Sales Development Rep
Template    SDR · books demos
Skills      apollo, gmail, hubspot, web-search
Channels    Email (sarah@yourco.com)  ·  Slack (#sarah)
Permissions send_email: auto  ·  refund: never  ·  cold_email_bulk: ask
Model       Claude Sonnet 4.6
Manager     Reports to nobody
```

Hit Create. **90 seconds later**:

- A Fly Machine boots in `lax` with Sarah's `/data` volume mounted
- SES provisions `sarah@yourco.com` + DKIM records auto-applied if you're on a managed zone
- A `#sarah` Slack channel auto-creates in your workspace, bot invited, topic set
- Sarah's first inbound triage runs — she reads a list of new leads from Apollo, drafts emails, posts to `#sarah` with previews for your approval

You DM `@Sentrel "sarah, reach out to anyone from a Series B company in our ICP this week"` in Slack. Sarah picks it up, builds a list, drafts 8 personalized emails, posts them in-thread asking which to send. You ✅ five of them. They go out. She logs each touch in HubSpot. The trace is at `/ops/runs` showing every tool call + cost.

That's what one agent looks like. Now multiply by your team.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                  www.sentrel.ai  (Rails control plane)             │
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

## What we built on top

Sentrel uses the [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) as the inner loop — model invocation, tool dispatch, skill primitives — but the SDK is one component among many. The agent loop alone doesn't make a hire-able teammate. The rest of the system is original:

**Runtime & infrastructure**
- Per-agent Fly Machine orchestration — provisioning, auto-start on inbound, `/data` volume lifecycle, fleet rolls
- Hetzner / DigitalOcean / local Docker provisioner backends as siblings to Fly
- WakeSweepJob — Rails-side cron that pre-wakes stopped machines before scheduled work fires
- Cron backfill on engine boot — never silently drops a missed schedule
- Anthropic billing proxy + OpenAI translator proxy — route the SDK through subscription auth (Claude Pro/Max, ChatGPT Plus) instead of metered API
- EngineSync — Redis pub/sub fan-out so config changes propagate without a deploy

**Channels (full implementations, not just API wrappers)**
- Email: SES inbound (SNS topics + receipt rules + auto-DNS) + outbound with RFC 822 threading + reply-as-agent flow
- Slack: OAuth install, signed webhook with replay protection + event dedup, multi-agent via channel-per-agent (`chat:write.customize` identity overrides), full Marketplace-ready manifest
- Telegram: per-agent bot tokens, polling, inline-keyboard approval prompts
- WhatsApp / SMS: Twilio integration with media fetch
- Web chat: ActionCable streams of live tool calls + approval prompts

**Policy + governance**
- Per-action policy engine — auto / draft / never modes, scopable to team / agent / tool
- PendingApproval flow with inline previews, Block Kit modals (planned), one-click approve from email
- ApprovalRule auto-matching — "auto-approve LinkedIn posts under 3/day" without human review
- AuditLog on every tool call, secret fetch, decision, with `acting_user_id` for human-of-record
- Per-agent encrypted credentials + `AgentCredentialGrant` ACL with `secrets.get` MCP tool

**Agent surface**
- Skills marketplace — fork, publish, install across orgs, multi-file CodeMirror editor
- Skill self-authoring — agents can compose new `SKILL.md` bundles and install them on themselves or teammates via MCP tools
- Knowledge base — per-agent + org-shared SQLite vector stores with `@huggingface/transformers` embeddings, URL ingest, PDF extraction fallback chain
- Memory consolidation — Haiku-summarized `MEMORY.md` that survives restarts
- Task system — `create_task`, `assign_to_role`, multi-agent delegation, report-back routing
- Scheduling — `scheduled_work` table + BullMQ + work-scheduler with `next_run_at` precomputed for Rails wake-sweep
- Integration search — RAG over the Composio catalog so the agent finds the right tool without us pre-loading 250+ servers
- `propose_connection` — agents can ask the user to connect a service mid-conversation with an inline Connect card

**Control plane (Rails)**
- Multi-tenant on `acts_as_tenant` with PrefixedIds (`agt_…`, `tsk_…`, `sch_…`) — public IDs that don't leak DB row counts
- Agent edit UI — identity, personality, instructions, signature; TipTap WYSIWYG with template-variable highlights
- Run tracer — span tree across agents (delegation), token + cost breakdown, replayable transcripts
- BYO domain auto-config — Route 53 / Cloudflare zone integration, apex-domain warning, SES region probe
- Domain migration on switch — rename addresses to new domain + EngineSync each affected agent

That's ~30k LoC of original code on top of the SDK. We use the SDK the way you'd use Redis: a great piece, but you still have to build everything around it.

---

## Repo layout

```
sentrel/
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
git clone git@github.com:ParseDev/double.md.git
cd double.md

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

**Rails control plane** — push to `main` with changes under `backend/**` triggers `app-deploy.yml`. The workflow builds + pushes the Rails image to GHCR, then SSH's into the EC2 host and runs `kamal deploy` + `db:migrate`. Live at <https://www.sentrel.ai>.

**Per-agent engine** — push to `main` with changes under `engine/**` triggers `engine-image.yml`. The workflow builds a multi-arch image and pushes `ghcr.io/parsedev/alchemy-engine:latest`. Each agent's Fly Machine pulls the new image on its next cold-boot (usually within 5 minutes since machines auto-stop when idle).

Manual triggers: both workflows have `workflow_dispatch` in the Actions tab.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Web framework | Rails 8 + Inertia.js + React 19 | Server-driven router; no API duplication; speed of Rails generators with React DX |
| ORM | Active Record + Postgres 16 | acts_as_tenant + PrefixedIds for multi-org safety |
| Background jobs | Sidekiq + sidekiq-cron | Wake sweeps, schedule rolls, OAuth refreshes |
| Agent inner loop | Claude Agent SDK on Bun | Fast cold-start TypeScript runtime; the SDK handles model invocation + tool dispatch — everything *around* the loop (channels, policy, scheduling, multi-agent, persistence) is ours |
| Agent hosting | Fly Machines (per-agent VM) | Auto-start on inbound, /data volume for memory, 25+ regions |
| Queues | BullMQ on Redis | Delayed jobs, cron, retries for agent inbox |
| Integrations | Composio + custom OAuth | 250+ apps via Composio, native Slack channel app, SES email |
| Models | Anthropic / OpenAI / OpenRouter | Per-agent model selection, BYO API keys |
| Deploy | kamal (Rails) + Fly Machines API (engine) | Single EC2 for the control plane, fleet of micro-VMs for agents |
| Auth | Devise + per-agent OAuth credentials | Org-scoped users + per-agent Slack / Gmail / Telegram tokens |

---

## Capabilities & policies

Every agent has the same baseline tools (web search, scheduling, RAG over your docs, task creation, secrets, the agent's own outbound channel). Beyond that, two layers shape what each agent can actually do:

**Capabilities** are coarse switches set at agent creation:

```
knowledge_base   Lets the agent read + cite your uploaded docs
scheduling       Set reminders, schedule recurring work
tasks            Create tasks, delegate to other agents, comment to log progress
integrations     Composio's 250+ apps + native channel integrations
recall           Search prior conversations and audit logs
send_media       Voice notes, images, file attachments on channel replies
```

**Skills** are markdown bundles the agent loads on demand (Claude Agent SDK's skill system). Anyone in your org can write one. Casper, our chief-of-staff agent, ships with `skill-creator` so he can author new skills for himself or other agents and install them. A skill bundle looks like:

```
my-skill/
├── SKILL.md                  # The instructions the agent reads
├── scripts/                  # Optional: pre-baked code the agent can run
└── references/               # Optional: docs the skill links to
```

**Policies** are per-action approval gates. Three modes per action:

```
auto    The agent does it without asking
draft   The agent prepares it, you get a one-click approve / reject card
never   The action is hidden from the agent entirely
```

Policies stack across levels: org-wide → team → per-agent → per-tool. A `send_email` policy of `auto` at the org level with `draft` overridden for `[email protected]` recipients gives you safe-by-default with surgical guardrails. Every approval (manual or auto-rule) writes an `audit_logs` row with full payload for compliance review.

---

## Security model

- **Per-agent isolation.** Each agent is its own VM with its own `/data` volume. Token compromise on Sarah doesn't affect Casper. Memory blowup on Casper doesn't slow down Sarah.
- **Encrypted credentials.** All `credentials.value` columns use Rails 7's `encrypts`. Bot tokens (Slack), API keys (Anthropic, OpenAI, …), and cloud creds (AWS, Stripe, …) round-trip through `ActiveRecord::Encryption`. The engine never holds raw tokens — it asks Rails via `/api/secrets` and gets back the resolved value scoped to that agent.
- **Per-agent OAuth grants.** A `Credential` belongs to the org; an `AgentCredentialGrant` says which agents can use which credential. Empty grant list = falls back to org defaults. Revoke a single grant to surgically cut access.
- **Audit trail.** Every tool call, every approval decision (manual + auto-rule), every secret fetch writes an `audit_logs` row with the acting agent, the human-of-record (`acting_user_id`), the action, and the full input/output payload.
- **HMAC-signed webhooks.** Slack, Stripe, Twilio, and SES inbound traffic all signature-verify before doing work. 5-min replay window on Slack; AWS SNS verification on SES.
- **No production secrets in git history.** Audited from initial commit forward.

---

## Extending it

### Writing a skill

The Claude Agent SDK reads markdown files as `Skill` definitions. To add a new skill:

```bash
mkdir -p backend/db/seeds/skills/common/refunds
cat > backend/db/seeds/skills/common/refunds/SKILL.md <<'EOF'
---
name: refunds
description: Process customer refund requests within policy
---
1. Look up the customer in Stripe.
2. Check the refund window (< 30 days from purchase).
3. If within policy, issue the refund + email the customer.
4. If outside policy, draft an explanation for human approval.
EOF
bin/rails db:seed:skills
```

Agents who have this skill installed can `Skill("refunds")` and read it on demand. No re-deploy needed — `EngineSync.trigger_for_skill` re-syncs every agent that has it.

### Adding a custom MCP tool

For tools that need to run code (not just read instructions), drop a file under `engine/src/tools/`:

```ts
// engine/src/tools/your-tool.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export function buildYourToolMcpServer(agentId: number) {
  return createSdkMcpServer({
    name: "your-tool",
    version: "1.0.0",
    tools: [
      tool(
        "your_tool.do_thing",
        "What this does, in one line the model will read",
        { input: z.string() },
        async (args) => ({ content: [{ type: "text", text: `Did: ${args.input}` }] }),
      ),
    ],
  });
}
```

Wire it up in `engine/src/agent-runner.ts` under the MCP server registration block (search for `mcpServers["secrets"] =`). Gate it on whatever capability makes sense.

### Spinning up a new agent host

The engine is provisioner-agnostic. To run agents somewhere other than Fly:

1. Implement an `AgentProvisioner` backend in `backend/app/services/agent_provisioner.rb` (sibling of `FlyBackend`).
2. Make sure your backend returns a stable `machine_id` and supports `start` / `stop` / `restart` / `redeploy`.
3. Flip `AGENT_PROVISIONER=hetzner` (or whatever you call it) in the Rails env.

There's a partial Hetzner backend in the codebase as a reference implementation.

---

## Local dev cheatsheet

```bash
# Boot everything from repo root
bin/dev
# → Vite (dev assets)  ·  Rails (port 3200)  ·  Sidekiq  ·  Engine (one local instance on port 3300)

# Just the backend, no engine
cd backend && bin/dev

# Reset the dev DB + reseed (templates, system skills, etc.)
cd backend && bin/rails db:reset && bin/rails db:seed

# Tail the engine logs for a specific agent in prod
flyctl logs -a alchemy-prod-agent-1

# Open a prod Rails console
cd backend && bin/kamal console

# Run the agent's engine locally pointed at prod DB (debug-only)
cd engine && EMPLOYEE_ID=1 DATABASE_URL=$(grep DATABASE_URL ../backend/.kamal/secrets | cut -d= -f2-) bun run dev
```

Common gotchas:
- **Bun's lockfile** generates on macOS but the engine Dockerfile is glibc Linux. Don't use `--frozen-lockfile` inside the engine container — the lockfile skips Linux-only optional deps. See `engine/Dockerfile` comment for context.
- **PrefixedIds** makes `agent.as_json[:id]` a string (`"agt_abc"`), never `.to_i` it for ordering. Use `created_at` instead.
- **acts_as_tenant** in tests requires `ActsAsTenant.with_tenant(org) { … }` blocks — easy to forget and tests pass empty.

---

## Roadmap

What's working today:
- ✅ Agent creation flow (scratch + template library)
- ✅ Multi-channel: email (SES), Slack (channel-per-agent), Telegram, web chat
- ✅ Composio + 250+ integrations
- ✅ Policy engine + per-action approvals
- ✅ Knowledge base (RAG over uploaded docs + URLs)
- ✅ Per-agent encrypted credentials with engine `secrets.get` MCP tool
- ✅ Skills system + agent self-authored skills
- ✅ Scheduling + cron with wake-from-sleep guarantee
- ✅ Audit log + run tracer + per-agent cost tracking
- ✅ BYO domain (Route 53 / Cloudflare auto-config) or managed subdomain

What's next:
- 🟡 Slack v2 — slash commands, Block Kit approval modals, DM routing
- 🟡 Slack Marketplace listing
- 🟡 Real customer case studies on the landing page
- 🟡 100 prebuilt agent templates with bundled skills + integrations
- 🟡 Approval rules UI (today rules are seeded via Rails console)
- 🟡 Mobile companion (approve / chat from your phone)
- 🟡 SOC 2 type 1

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

## FAQ

**How is this different from Lindy / Relevance / OpenAI's "Assistants"?**
Lindy and Relevance are **workflow builders** — drag boxes, connect outputs to inputs. Great for one-shot automations. OpenAI's Assistants API is a **stateful chat endpoint** — you wire it into your own UI and host the integration layer yourself. Sentrel gives you persistent **employees** who own a role and react to events 24/7 inside your existing channels. The mental model is "a teammate logs into Slack" not "a workflow runs when triggered" and not "build your own product on top of an API."

**How is this different from agent frameworks like OpenClaw / LangGraph / AutoGen / crewAI?**
Those are **libraries** — you write Python or TypeScript that calls them, then you figure out everything else: hosting, observability, multi-tenant isolation, OAuth flows, retry logic, channel ingress, approval UI, audit trail, billing. Sentrel is a **platform** — your "agent code" is a row in a templates table and a markdown skill bundle; everything around it is solved. You can still drop into our engine's TypeScript when you want to write a custom MCP tool, but the 80% case never needs that. Frameworks give you a runtime; we give you a workspace.

**Why per-agent VMs instead of one shared engine?**
Three reasons. (1) **Isolation**: when an agent's prompt grows or its node modules corrupt, it doesn't take down the rest of the fleet. (2) **State**: each agent has its own `/data` volume — memory, RAG indices, OAuth token caches all survive restarts without a shared database becoming a bottleneck. (3) **Cost transparency**: machine-level cost = agent-level cost. You see exactly what each agent costs.

The tradeoff is per-agent compute floor (~$0.50/month idle, ~$6/month always-on). At small fleets that's fine; at 1000+ agents we'd reconsider.

**Can I self-host?**
Not yet — the deployment story assumes ScribeMD's AWS account + Fly org. The code is structured to make this swap-able (see "Spinning up a new agent host" above) but we haven't dogfooded the self-host path. Reach out if you want to be the first.

**What does it cost to run?**
At today's pricing: Rails control plane on one t3.medium ≈ $25/mo, Fly Machines ≈ $0.50-$6/agent/mo depending on activity, model API calls pass-through to whichever provider the agent uses. A 10-agent team running mostly Claude Sonnet 4.6 with moderate activity is ~$200-400/mo all-in.

**How do you handle context across model providers?**
We don't try to. Each agent's session lives on one model. You can swap the model per agent (so Sarah uses Claude, Casper uses GPT) but cross-provider context migration is out of scope — the abstractions leak too much to be useful.

**Is there a SaaS sign-up?**
Yes — <https://www.sentrel.ai>. Early access is friendly and the docs are real, but expect rough edges. Email us if anything breaks.

---

## Contributing

Internal team only for now. If you're early-team material and want to build something here, reach out. Issues + PRs from external contributors will get a friendly "not yet" until we're past v1.

---

## License

Source-available under a custom license — see [`LICENSE`](LICENSE) (TBD). Production use by ScribeMD; external commercial use case-by-case until we settle on terms.

---

<sub>Made with attention to detail and a slightly unreasonable amount of caffeine, in Algiers and Paris.</sub>
