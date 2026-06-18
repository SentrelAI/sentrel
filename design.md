# Alchemy — System Design

> **AI employees that live inside the tools your team already uses.**
> An agent platform — not a chatbot wrapper.

This document describes the current design of Alchemy: its architecture, the
responsibilities of each component, the data model, and the control/data flows
that tie them together. It reflects the system as built, with pointers to the
source that implements each piece.

---

## 1. Design goals

The system is shaped by five product commitments, each of which forces a
specific architectural decision:

| Commitment | Architectural consequence |
| --- | --- |
| Every agent is a **real teammate** with its own identity and logins | **One isolated process per agent** — a dedicated Fly Machine with its own `/data` volume, credentials, and channel identities. |
| **Real OAuth, not scrapers** | Native integrations via Composio (250+ tools) + first-class channel apps (SES, Slack, Telegram, Twilio). |
| **Policy-gated** actions | A per-action approval engine (auto / draft / never), evaluated before any high-risk tool call commits. |
| **Model-agnostic** | Per-agent LLM routing (Anthropic, OpenRouter, OAuth subscriptions) selected at provisioning time. |
| **Replayable** | Every tool call, decision, and dollar spent is streamed to the control plane and stored as an auditable trace. |

The throughline: **isolation**. When one agent's OAuth token is revoked, its
prompt balloons to 80 KB, or it runs `rm -rf`, no other agent is affected.
Costs, credentials, and failures are all per-agent.

---

## 2. Two-plane architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                  alchemy.scribemd.ai  (Rails control plane)         │
│                                                                     │
│  Auth · orgs · agents · policies · approvals · templates · skills   │
│  Inertia + React UI · SES/Slack/Twilio gateways · audit & traces    │
└─────────────┬───────────────────────────────────────────────────────┘
              │  Redis pub/sub  +  HTTPS /api/*  (X-Engine-Secret)
              │
   ┌──────────┴───────────┬──────────────────┬─────────────────┐
   ▼                      ▼                  ▼                 ▼
┌────────┐            ┌────────┐         ┌────────┐        ┌────────┐
│ Sarah  │            │ Casper │         │ Jamie  │        │  ...   │
│  SDR   │            │  CoS   │         │   CX   │        │        │
│  Fly   │            │  Fly   │         │  Fly   │        │  Fly   │
│Machine │            │Machine │         │Machine │        │Machine │
└────────┘            └────────┘         └────────┘        └────────┘
   bun + Claude Agent SDK + per-agent /data volume + BullMQ inbox
```

- **Control plane** — `backend/`, a Rails 8 + Inertia/React app. The source of
  truth for identity, policy, billing, and the audit trail. It provisions
  agents, owns the database, terminates inbound channel traffic, and renders
  the operator UI.
- **Agent runtime (engine)** — `engine/`, a TypeScript app on Bun wrapping the
  [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk). One instance
  runs per agent inside its own Fly Machine. It executes the agent loop, hosts
  the MCP tools, runs RAG, and delivers channel replies.
- **Bundle spec** — `agent-manifest/`, the `agent-bundle/v1` spec ("the
  Dockerfile of AI agents"): a portable `agent.yaml` + persona/skill/knowledge
  files describing an agent, with a generator and validator.

The two planes share **only** PostgreSQL and Redis. They never share process
memory. Communication is:

- **Rails → engine**: Redis pub/sub (`agent-{id}-sync`, `agent-{id}-approvals`)
  for config reloads and approval responses; the inbox Redis list
  (`agent-inbox-{id}`) for work.
- **Engine → Rails**: HTTPS to `/api/*`, authenticated with the
  `X-Engine-Secret` header, for event streaming, secret fetches, approvals,
  spend checks, and channel delivery.

---

## 3. Control plane (Rails) — `backend/`

### 3.1 Domain model

Multi-tenant on `acts_as_tenant` with `Organization` as the tenant root. Public
IDs are opaque **PrefixedIds** (`agt_…`, `tsk_…`, `cnv_…`, `sch_…`, `aprl_…`,
`log_…`) so API responses never leak DB row counts.

**Tenancy & identity**
- `Organization` — tenant root; owns agents, conversations, tasks, credentials,
  rules, audit logs, integrations, templates. Owns an `email_domain` (1:1) for
  inbound SES routing.
- `User` — Devise + Google OAuth; has one active org (`organization_id`) for
  tenancy but may belong to many orgs via `Membership` (per-org role). Platform
  admins gated by an email allowlist.
- `Membership` — user ↔ org join carrying the per-org role
  (owner/admin/member/viewer).

**Agent & configuration**
- `Agent` (`agt_*`) — the core unit. Hierarchical via `manager_id` (sub-agents).
  States: pending → starting → running → paused → stopped. Owns its `Instance`,
  `AiConfig`, channel configs, conversations, tasks, scheduled work, approvals,
  webhooks, tool policies, credential grants, skills, audit logs, summaries.
- `Instance` — 1:1 with agent; tracks the provisioned machine (provider,
  `machine_id`, `public_ip`, provisioning state).
- `AiConfig` — per-agent LLM routing (provider, model, thinking level,
  temperature, max tokens). Provider/model changes trigger a machine reload.

**Credentials & secrets (multi-tier)**
- `Credential` — encrypted store, three kinds: `llm_api_key`, `cloud_provider`,
  `generic`. Scoped to org or locked to a single agent. **Resolution order:**
  agent-owned → agent grant → org default → platform ENV fallback.
- `AgentCredentialGrant` — whitelist join; when grants exist for an
  (agent, provider, kind), only those org credentials are visible to the agent.
- `OauthCredential` — OAuth subscriptions (Anthropic Pro/Max/Team, ChatGPT
  Plus/Pro/Business). Never exposed to agents; refreshed by a background job.

**Skills & integrations**
- `SkillDefinition` — marketplace/org/private skills; tracks
  `requires_capabilities`, `requires_connections`, and `install_count`. System
  skills seeded from `db/seeds/skills/**`.
- `AgentSkill` — agent ↔ skill enablement join.
- `SkillBundle` / `SkillFile` — grouping and uploaded skill source files.
- `Integration` — a Composio toolkit connection, org- or user-scoped, with a
  `composio_user_id` bucket and connection status.

**Conversations & messages**
- `Conversation` (`cnv_*`) — a thread; `internal` (dashboard) or `external`
  (inbound). Cross-channel threads merge via `unified_conversation_id`.
- `Message` (`msg_*`) — role user/assistant/system; may carry attachments;
  assistant messages broadcast over ActionCable.

**Tasks & scheduling**
- `Task` (`tsk_*`) — todo/in_progress/awaiting_input/done/failed/cancelled, with
  a `parent_task`/`child_tasks` delegation tree (cancellation walks the tree).
  Each task has a dedicated conversation for session resume.
- `ScheduledWork` (`sch_*`) — modes `cron` / `once` / `interval`; the engine
  registers BullMQ jobs from it and Rails wakes machines ahead of `next_run_at`.

**Policy, approvals & audit**
- `PendingApproval` — a human-intervention gate (pending/approved/rejected)
  capturing the tool, its input, and the resolver; posts a Slack approval card
  on creation when Slack is connected.
- `ApprovalRule` (`aprl_*`) — standing auto decision (approve/reject) with a
  JMESPath predicate, optionally scoped to an agent/payload type.
- `AgentToolPolicy` — per-toolkit ACL (read_only/read_write/full/custom) with
  explicit allow/deny lists.
- `AuditLog` (`log_*`) — every secret fetch, tool call, and decision, with the
  acting user as human-of-record.
- `AgentSummary` — daily per-agent rollups (messages, emails, tasks, approvals,
  errors, per-channel breakdown).

**Templates**
- `AgentTemplate` / `AgentTemplateVersion` — immutable published blueprints
  (role, persona markdown, suggested skills/integrations/model) used to create
  agents; every publish snapshots a version.

### 3.2 Provisioning

`AgentProvisioner` (`app/services/agent_provisioner.rb`) is the backend router,
selected by the `AGENT_PROVISIONER` env var:

- **Fly (recommended)** — one Fly App per agent (`alchemy-{env}-agent-{id}`),
  a 10 GB `/data` volume, and a Machine (2 CPU / 4 GB) running the engine image.
  Boots in 1–3 s (Firecracker micro-VMs); scales to zero when idle.
- **Hetzner** — cost-optimized VMs with dedicated IPs (≈60 s boot); credential
  stored as a `cloud_provider` Credential.
- **Local** — docker-compose for dev; marks the instance running without real
  provisioning.
- **Null** — no-op default when no provider is configured.

`env_for` bakes the machine environment: `EMPLOYEE_ID`, `DATABASE_URL`,
`REDIS_URL`, `ENGINE_API_SECRET`, `RAILS_INTERNAL_URL`, BYO keys (Composio,
OpenAI), Sentry, and the **LLM routing** vars (direct Anthropic key,
OpenRouter base URL, or an in-process billing/translator proxy for OAuth
subscriptions). Provisioning runs async in `ProvisionAgentJob` (Sidekiq, retried)
so the create request returns immediately. `AgentMachineOps` handles
start/stop/reload.

### 3.3 Policy & approval engine

When the engine reaches a high-risk tool call it consults the control plane via
`POST /api/approval_rules/match` (org, agent, payload type, payload):

1. `ApprovalRule.match` scans enabled rules (agent-specific then org-wide;
   payload-type-specific then null), evaluating each JMESPath predicate.
2. **Match → auto-resolve** with the rule's decision (the *auto* and *never*
   modes), returned to the engine immediately.
3. **No match → create a `PendingApproval`** (the *draft* mode), post a Slack
   Block Kit card if configured, and return `pending` so the engine pauses at
   the tool call.

Operators resolve the queue at `/pending_approvals`; command/spend approvals
flow back to the engine over Redis pub/sub, and the engine resumes or aborts.

### 3.4 Channels (inbound termination)

The control plane terminates all inbound channel traffic and normalizes it into
conversations + inbox jobs:

- **Email (SES)** — `/webhooks/email` handles SNS confirm + notifications;
  `Email::InboundProcessor` routes by recipient → agent, dedupes by message-id,
  and threads within a 7-day window. Outbound via `Email::OutboundSender`
  (MIME + RFC 822 threading), with bounce/complaint suppression and DKIM/DMARC
  auto-config helpers.
- **Slack** — `/webhooks/slack` verifies the HMAC signature, dedupes event IDs
  (5-min Redis TTL), and routes by `team_id`. OAuth install via
  `OauthController`; outbound + Block Kit approval cards via `Slack::*` services,
  using `chat:write.customize` for per-agent identity.
- **Telegram / WhatsApp / SMS** — `/webhooks/telegram/:bot_token`,
  `/webhooks/whatsapp`, `/webhooks/sms` (Twilio), each with signature checks.
- **Web chat** — `/webhooks/web` + `AgentChatChannel` (ActionCable) for
  real-time bidirectional streaming.
- **Generic hook** — `/hooks/:token` accepts arbitrary JSON keyed by an
  `AgentWebhook` token.

`ChannelConfig` stores per-agent channel bindings (encrypted tokens + public
metadata).

### 3.5 Engine-facing API (`/api/*`, `X-Engine-Secret`)

- `POST /api/agent_events` — engine streams every tool call/result, text delta,
  approval, and error; Rails rebroadcasts over `AgentChatChannel`.
- `GET /api/secrets` — credential fetch (resolved by the multi-tier order),
  audited via `AuditLog`.
- `POST /api/agent_instances/ready` — cloud-init callback flipping the instance
  to `running` and recording its IP.
- `POST /api/approval_rules/match` — standing-rule consultation (§3.3).
- `GET /api/spend_caps/check` — daily/monthly cap enforcement.
- `POST /api/skills` — agent-authored skill publish/install.
- `POST /api/send_email`, `POST /api/send_slack_message` — outbound delivery.

### 3.6 EngineSync, wake-sweep & billing proxies

- **EngineSync** (`app/services/engine_sync.rb`) — publishes to
  `agent-{id}-sync` so config changes (agent edits, skill updates fanned out to
  every agent using a skill, channel changes) propagate without a deploy.
  Non-fatal; the engine also re-reads config on every job.
- **WakeSweepJob** — Sidekiq cron (1-min) that wakes stopped machines ~90 s
  before their `next_run_at`/`fire_at`, covering machine boot + engine startup +
  BullMQ pickup so scheduled work never silently slips.
- **Billing proxies** — `RefreshOauthTokensJob` (30-min) refreshes OAuth
  subscription tokens. For `anthropic_account`/`openai_account` routing, the
  engine's `ANTHROPIC_BASE_URL` points at an in-process proxy
  (`127.0.0.1:18801`) that injects the Claude Code identifier and forwards to
  the provider, billing against the user's subscription instead of metered API.
  The OpenAI proxy additionally translates Anthropic ↔ OpenAI request formats.

### 3.7 Frontend & background jobs

Inertia + React (TSX) under `app/frontend/`. Shared props (`auth`, the
`agents_tree` sidebar, flash) hydrate every page; ActionCable streams live agent
activity. Key surfaces: agent chat, agent settings, conversations, tasks,
approvals queue, skills marketplace (with in-browser editor), templates, and the
platform-admin dashboard.

Sidekiq jobs: `ProvisionAgentJob`, `WakeSweepJob`, `RefreshOauthTokensJob`,
`SendEmailJob`, `UpdateAgentEngineJob`, `RefreshComposioCacheJob`,
`EmployeeHealthCheckJob`, `ArchiveDormantConversationsJob`, digest/summary jobs.

---

## 4. Agent runtime (engine) — `engine/`

A TypeScript app on Bun. One instance per agent inside a Fly Machine, wrapping
the Claude Agent SDK as the inner loop and building everything else around it.

### 4.1 Boot & the run loop

- `src/main.ts` — boot: load agent config from the DB, sync the workspace, start
  the work scheduler, the inbox poller, the gateway (HTTP + WebSocket), and
  channel pollers; init Sentry; graceful shutdown.
- `src/agent-runner.ts` — `runAgent()` processes one BullMQ job. Per turn:
  conversation lookup → session resume/rotation decision → prompt build (with
  knowledge prefetch) → MCP server setup → Claude Agent SDK loop → response
  persistence → outbox processing → channel delivery. Handles job types
  `inbound_message`, `task_assignment`, `scheduled_task`, `heartbeat`,
  `task_cancelled`.

**Session rotation** (`src/session-rotation.ts`) is token-utilization based with
a hard cap (~200 turns); on rotation, old turns are summarized into
`conversation_summaries` and durable facts are consolidated into memory.
**Spend caps** (`src/spend-caps.ts`) hard-stop over budget and warn when
approaching. A **tool interceptor** captures email writes, scans shell commands,
and filters secrets out of outputs.

### 4.2 MCP tools

Built-in MCP servers (`src/tools/`) always loaded:

| Tool(s) | Purpose |
| --- | --- |
| `search_messages` | Fuzzy recall across conversations (pg_trgm). |
| `search_knowledge`, `share_to_org` | RAG search; promote a personal doc to the org KB. |
| `create_task`, `list_tasks`, `update_task`, `comment_on_task` | Task CRUD + cross-agent delegation. |
| `set_reminder`, `schedule_task`, `list_schedules` | Create cron/interval/once jobs. |
| `request_action_approval` | Inline high-risk action approval. |
| `send_message`, `send_image`, `send_document` | Telegram/WhatsApp/web delivery. |
| `get_secret`, `set_secret` | Credential access (audited via Rails). |
| `create_skill`, `install_skill` | Author + install skills on self/teammates. |
| `post_to_slack`, `send_slack_message` | Slack delivery. |
| `search_integrations` | Dynamically load Composio toolkits at runtime. |

Plus the **Composio MCP server** (`src/integrations/`): intent-router keyword
matching loads only the relevant toolkits (RAG over the 250+ catalog rather than
preloading), with a circuit breaker and user-over-org credential precedence; and
the **Claude Agent SDK built-ins** (`WebSearch`, `WebFetch`, `Read`, `Write`,
`Bash`, `Browser`, `Grep`, `Glob`, `Edit`, `Skill`, `Agent`).

### 4.3 Channels (delivery & polling)

The engine handles outbound delivery and any poll-based inbound:

| Channel | Inbound | Outbound |
| --- | --- | --- |
| Telegram (`channels/telegram.ts`) | Long-poll `getUpdates`; button callbacks for approvals | `sendMessage` with streaming deltas |
| WhatsApp (`channels/whatsapp.ts`) | Rails webhook → Redis inbox | `sendMessage`; YES/NO approval replies |
| Email (`email/*`) | Rails inbound → conversations | `workspace/outbox/*.json` → `processOutbox` → PendingApproval; approve-by-reply |
| Slack (`channels/slack.ts`) | Rails webhook → inbox | `deliverSlackReply` via `/api/send_slack_message`; Block Kit cards |
| Web (`channels/origin-delivery.ts`, `gateway.ts`) | Rails webhook → conversations | WebSocket broadcast + relay to `/api/agent_events` |

**Inbound flow:** Rails saves the message → `LPUSH agent-inbox-{id}` → engine
inbox poller `BRPOP` → BullMQ → `runAgent` → on done, the channel listener
delivers the reply.

### 4.4 Memory

`src/memory.ts` lays out the `/data` workspace: `soul.md` (identity, synced from
DB each boot), `memories/memory.md` (bounded agent-managed notes, ~2200 char
cap), `memories/contacts.md`, `skills/` (synced from DB), `workspace/{outbox,
inbox, screenshots, documents}`, and `.claude/` (SDK session transcripts,
symlinked to `$HOME/.claude`). The SDK persists transcripts as `.jsonl`; the
engine resumes via `options.resume = sessionId`. `memory-consolidation.ts`
extracts durable facts at rotation into `agent.memory_md` (DB-backed, read back
into `memory.md`). All workspace writes pass through an injection scanner
(`security/injection-scanner.ts`), which soft-fails with a warning.

### 4.5 Knowledge base / RAG

- **Store** (`rag/store.ts`) — libsql (SQLite + native `F32_BLOB` vectors,
  `vector_distance_cos`). Two scopes: `agent-{id}.db` (personal) and
  `org-{id}.db` (shared). Schema: `documents` → `chunks` (content + embedding +
  context). ANN index + FTS5 keyword search, fused via **Reciprocal Rank
  Fusion** (K=60).
- **Ingest** (`rag/ingest.ts`, `extractor.ts`, `chunker.ts`) — `POST /rag/ingest`
  on the gateway; extractor handles PDF (llamaparse), Markdown, text, HTML, and
  URLs; semantic chunking with context windows.
- **Embeddings** — HuggingFace BGE-small-en-v1.5 (384-dim) loaded on first boot
  from a baked `/opt/hf-cache`.
- **Prefetch** — each turn hybrid-searches the user message and injects cited
  results into the prompt (skipped in fast-chat mode); the agent can also call
  `search_knowledge` for custom queries. `share_to_org` copies a doc to the org
  scope with content-hash dedup.

### 4.6 Scheduling, tasks & inbox

- **Work scheduler** (`work-scheduler.ts`) — polls `scheduled_work` every 60 s,
  registering BullMQ jobs (cron repeat / interval / delayed once). Missed cron
  ticks within 24 h backfill on boot; stable job IDs dedupe across restarts.
- **Tasks** (`tools/tasks.ts`, `host/host.ts`) — cross-agent `create_task`
  auto-wakes the target via the inbox; parent tracking propagates cancellation.
- **Inbox** (`inbox.ts`) — a Redis list `agent-inbox-{id}`; Rails `LPUSH`, engine
  `BRPOP` (5 s block) → BullMQ, with job-ID dedup.

### 4.7 Rails bridge & skills

All persistence flows through the **host abstraction** (`host/host.ts` interface,
`host/postgres.ts` implementation) — no direct DB access elsewhere — enforcing
tenant isolation. Engine→Rails uses `RAILS_INTERNAL_URL` + `ENGINE_API_SECRET`;
Rails→engine uses the `agent-{id}-sync` / `agent-{id}-approvals` pub/sub
channels.

**Skills** (`skills.ts`) — DB-installed multi-file bundles (`SKILL.md` +
helpers/schemas) sync per job and on `/sync`, with path normalization
(`../` rejected), injection scanning (any threat blocks the whole skill), and
orphan cleanup. Role defaults seed a starter set (e.g. SDR → send-email,
sdr-outreach, sdr-prospecting, web-search, stealth-browser). A skill's
`system_prompt_fragment` is injected into the system prompt.

---

## 5. Agent bundle spec — `agent-manifest/`

The `agent-bundle/v1` spec is a portable, declarative description of an agent:
a directory with an `agent.yaml` manifest plus the persona, skill, and knowledge
files it references — "the Dockerfile of AI agents."

- **Generate** — `npx @manifestagent/agentmanifest generate` runs an interactive
  wizard (name/mission, model, email channel, MCP servers/integrations,
  schedules, skills, knowledge, secret *names*, permissions) and scaffolds +
  validates a bundle. Persona files (`personality.md`, `identity.md`,
  `instructions.md`) are stubs marked with `TODO`.
- **Validate** — `npx @manifestagent/agentmanifest validate <dir>` checks the
  manifest against `schema/agent-bundle.v1.schema.json`, verifies referenced
  files exist, and scans for secret *values* (only secret names may be declared).
- **Inputs** — `inputs[]` declares owner-filled variables that substitute
  `{{key}}` tokens across all text (typed: text/list/number/boolean/enum, with
  validation and `ask_at: deploy|onboarding`). The platform always provides
  `user_name`, `company_name`, `agent_name`, `company_domain`.

Example bundles live under `agent-manifest/examples/` (sdr, marketing,
scheduler, bugfixer).

---

## 6. End-to-end flows

### 6.1 Hiring an agent

1. Operator submits `/agents/new` (or installs a template/bundle).
2. Rails creates `Agent` + `Instance` (+ `AiConfig`, `ChannelConfig`s) and
   enqueues `ProvisionAgentJob`.
3. The provisioner boots a Fly Machine with the engine image and the baked
   environment; SES provisions the address + DKIM; a `#agent` Slack channel is
   created.
4. The engine boots, syncs its workspace from the DB, and `POST`s
   `/api/agent_instances/ready` → instance flips to `running`.

### 6.2 Inbound message → reply

1. A channel webhook (or poll) lands at the control plane (or engine).
2. Rails normalizes it into a `Conversation`/`Message` and `LPUSH`es a job onto
   `agent-inbox-{id}`.
3. The engine inbox poller `BRPOP`s it into BullMQ; `runAgent` builds the prompt
   (memory + RAG prefetch), runs the SDK loop, and streams every step to
   `/api/agent_events` (rebroadcast live to the browser).
4. High-risk tool calls hit the approval engine (§3.3); the turn pauses on a
   `PendingApproval` until resolved.
5. On completion, the channel listener delivers the reply and an `AuditLog` /
   `AgentSummary` record the activity.

### 6.3 Scheduled work

1. An agent (or operator) writes a `ScheduledWork` row.
2. `WakeSweepJob` wakes the machine ~90 s before `next_run_at`.
3. The engine's work scheduler fires the BullMQ job → `runAgent` with
   `scheduled_task` → same delivery/audit path as inbound.

---

## 7. Cross-cutting concerns

- **Isolation** — one process, volume, credential set, and channel identity per
  agent; failures and costs never cross agents.
- **Security** — `X-Engine-Secret` on every engine→Rails call; encrypted
  credentials with a strict multi-tier resolution order; injection scanning on
  all workspace/skill writes; secret filtering in tool outputs; command scanning
  and approval gates for dangerous shell.
- **Auditability** — `AuditLog` on every secret fetch, tool call, and decision
  with the acting user as human-of-record; replayable run traces (span tree
  across delegated agents) with token + cost breakdown.
- **Resilience** — config re-read on every job (pub/sub is best-effort);
  scheduled-work backfill on boot; stable job IDs for dedup; HuggingFace model
  download retries in the engine image build.
- **Cost control** — per-agent spend caps (engine-enforced) plus daily/monthly
  caps checked against the control plane; scale-to-zero idle machines; OAuth
  subscription billing proxies as an alternative to metered API.

---

## 8. Repo layout

```
alchemy/
├── backend/          # Rails 8 + Inertia/React control plane
│   ├── app/          #   models, controllers, services, jobs, frontend (TSX)
│   ├── config/       #   deploy.yml (kamal), initializers (prefixed_ids, …)
│   └── Dockerfile    #   web image
├── engine/           # TypeScript per-agent runtime (Bun + Claude Agent SDK)
│   ├── src/          #   agent-runner, MCP tools, channels, rag, host bridge
│   ├── Dockerfile    #   bun + SDK + baked HF embedding cache
│   └── fly.toml      #   per-agent Fly app template
├── agent-manifest/   # agent-bundle/v1 spec — generator, validator, schema
├── docs/             # design notes (hosting, integrations, deploy, channels)
├── bin/{setup,dev}   # install + boot both halves
└── .github/workflows # engine image build + app deploy + CI
```

---

*This document describes the system as currently built. For provider trade-offs
see `docs/per-agent-hosting.md`; for integration setup see
`docs/integrations.md`; for the bundle spec see `agent-manifest/README.md`.*
