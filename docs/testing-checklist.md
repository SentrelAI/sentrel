# Manual testing checklist — to run on next engine restart

Keep this up to date as new features land. Each checkbox should pass before shipping.

## Gateway + scheduled task channel routing (commits `59b0ea5` + `86f6ad6`)

- [ ] Restart the engine. Boot log should look identical to before.
- [ ] Send a Telegram message while a long scheduled task is running — **no tool-label leakage** into the Telegram thread.
- [ ] Scheduled task fires → final text delivers to the configured channel:
  - Chat-created schedule → that chat's channel (Telegram/WhatsApp/web).
  - UI-created schedule → the dropdown value.
- [ ] Create a new schedule in the Schedule tab, pick **Telegram** → instruction fires → reply lands in your Telegram.
- [ ] Create a schedule and pick **Silent** → task runs, nothing delivered, `/ops/runs/<id>` has the full output.
- [ ] Edit an existing schedule → dropdown reflects the current delivery channel (or "silent" if instruction starts with `[SILENT]`).

## Capabilities system

- [ ] Brand-new agent: `capabilities = {}` → engine log shows `MCP servers registered:` without `knowledge`, `search_knowledge` is not in the toolbelt.
- [ ] Upload first doc → log shows `auto-enabled knowledge_base capability for agent N` → psql: `SELECT capabilities FROM agents WHERE id = N;` shows `knowledge_base.enabled: true`.
- [ ] Send agent a message referencing the doc → log shows `Knowledge prefetch: "…" → N/M passages above threshold 0.75`, response cites the doc.
- [ ] Send "hi" → log shows `0/N above threshold 0.75`, normal reply.
- [ ] Toggle `knowledge_base.enabled = false` in `/agents/agt_.../edit` → next message: log shows `MCP servers registered: …` without `knowledge`.
- [ ] `/ops/runs/<id>` Meta row shows 6 capability chips, green/struck matching the run's state.

## Public IDs

- [ ] `/agents` → click any agent → URL is `/agents/agt_…`.
- [ ] `/tasks/tsk_…`, `/agents/agt_…/conversations/cnv_…` all resolve.
- [ ] ActionCable: open task in two tabs, comment in one → other updates live (broadcast uses prefix id).
- [ ] Composio still works: ask agent to do something Gmail/Notion-related → `user_id="org_<numeric>"` preserved (schedule's `org_2` shouldn't break).
- [ ] Telegram inbound → reply works end-to-end (engine queue `employee-2` unchanged).

## Engine sync

- [ ] Edit agent identity/personality/instructions in `/agents/agt_…/edit` → save → Rails posts `/sync` → engine logs `Config synced (including channels)`.
- [ ] Toggle a skill → engine re-provisions `skills/<slug>/SKILL.md`.
- [ ] Update a channel config → engine reloads Telegram polling / WhatsApp init (may take up to ~30s for Telegram long-poll to drain).

## Integrations

- [ ] `bin/rails integrations:check` shows ✓/✗ per curated service and active connections per org.
- [ ] `/integrations` → Connect Gmail/Notion → OAuth popup → integration row flips to `connected`.
- [ ] Agent chat "check my inbox" → engine logs `GMAIL_FETCH_EMAILS` tool call, response cites real messages.
- [ ] `/ops/runs/<id>` Timeline shows the Composio tool spans.

## Stale conversation merge

- [ ] `rake 'merge:internal_conversations[dry]'` — prints expected summary, no DB writes.
- [ ] Live run (`rake merge:internal_conversations`) — reparents messages + tasks, deletes empty convs.
- [ ] Rerun dry — 0 groups found (idempotent).

## Idempotency keys on retryable jobs (commit `7faadb9`)

- [ ] Create a task → Rails log shows the enqueue; check BullMQ Redis — job id is `task-assign-<id>`, not a UUID.
- [ ] Re-submit the same comment form twice rapidly → only one `task-comment-<id>` job enqueues (second is a BullMQ no-op).
- [ ] Simulate Twilio webhook retry (same MessageSid replayed) → second call is deduped; check `inbound-whatsapp-<sid>` appears once in Redis.
- [ ] SES replay same email with same Message-ID → deduped similarly.

## Circuit breakers (commit `6e4856a`)

- [ ] Kill network (`sudo pfctl -e` rule blocking openai.com or similar) while agent tries to transcribe a voice note → after 3 consecutive fails, engine logs `CircuitBreaker[openai-whisper]: OPEN`, next attempts fast-fail.
- [ ] Restore network, wait 30s → next attempt logs `HALF-OPEN — probing` then `CLOSED (recovered)`.
- [ ] Same for TTS (openai/elevenlabs/cartesia breakers are independent).
- [ ] Twilio send failure → breaker opens, chunks fast-fail with "WhatsApp: send chunk failed" but agent completion isn't blocked.

## RAG per-document threshold (commit `6201f90`)

- [ ] Set a document's metadata threshold via `sqlite3 agent_data/rag/agent-N.db "UPDATE documents SET metadata = json_object('threshold', 0.6) WHERE id = 1;"`.
- [ ] Send a borderline-match query → engine log: that doc's chunk is kept at 0.6 even though agent default is 0.75.
- [ ] Unset (`metadata = '{}'`) → back to agent-level threshold.

## Specs (commit landing spec coverage)

- [ ] `bundle exec rspec spec/models/agent_capabilities_spec.rb spec/models/public_id_serialization_spec.rb spec/services/engine_sync_spec.rb spec/tasks/merge_internal_conversations_spec.rb` — all 21 examples green.
- [ ] Run full suite (`bundle exec rspec`) in CI before merge — 86+ examples.

## Agent templates (commits `d77847c` + `cd14521` + `e37d4b6`)

- [ ] `/agents/new` shows the template picker grid with 14 roles (CEO, Marketing Lead, Compliance Officer, Proposal Writer, Engineer, Product Manager, Designer, Content Writer, Data Analyst, Finance, SDR, Support, Researcher, Recruiter).
- [ ] Each template shows icon + name + description + "reports to X" + top skill badges.
- [ ] Pick "Marketing Lead" → Step 2 form prefills role, model (Sonnet 4.6), capabilities, and auto-selects the CEO agent as manager.
- [ ] Pick "CEO" → Model dropdown prefilled with Opus 4.7 + hint "Template recommends claude-opus-4-7 for this role."
- [ ] Pick "Support" → Model prefilled with Haiku 4.5.
- [ ] Submit with name "Sarah" → agent created, Identity tab shows SOUL.md with "I am Sarah, the Marketing Lead at <OrgName>...".
- [ ] Capabilities from template apply (knowledge_base on by default for roles that want it).
- [ ] Suggested skills auto-install (`agent_skills` rows created + enabled).
- [ ] Edit page has no identity/personality/instructions textareas — links to Identity tab instead.
- [ ] Edit page has Manager dropdown listing every other agent in the org.
- [ ] `rake db:seed` is idempotent — rerun doesn't duplicate.

## Cross-agent tasks + delegation (commit `b77e2af`)

- [ ] CEO's system prompt shows a "Your team" section listing direct reports with role + skills + one-line summary.
- [ ] CEO message: "Ask Marketing to draft an RFP for X" → engine log shows `create_task` with `assign_to_role: "Marketing"`.
- [ ] `psql`: `SELECT id, agent_id, assigned_by_agent_id FROM tasks ORDER BY id DESC LIMIT 1;` → assigned_by_agent_id = CEO's id, agent_id = Marketing's id.
- [ ] Marketing's inbox immediately has the task_assignment: `LRANGE agent-inbox-<marketing_id> 0 0`.
- [ ] Marketing completes → CEO inbox gets a task_assignment with "Task completed by <Marketing name>: ... Result: ...".
- [ ] CEO's follow-up instruction tells it to check whether the original requester (Telegram/WhatsApp/email) needs an update.

## Org-shared knowledge (commits `f61c450` + `809406d`)

- [ ] Knowledge tab has a Personal / Org-shared toggle.
- [ ] Upload with Personal → indexed at `agent_data/rag/agent-<id>.db`.
- [ ] Upload with Org-shared → indexed at `agent_data/rag/org-<org_id>.db`.
- [ ] Different agent in same org → their `search_knowledge` hits show BOTH sources with `[personal/org-shared]` markers.
- [ ] `share_to_org(document_id: N)` tool called by an agent → document copied to org KB; subsequent teammates see it in search.
- [ ] Delete with scope=org removes from shared KB only.

## Skills dependencies + bundles (commit Phase 4 Rails + engine)

- [ ] `SkillDefinition.new(required_capabilities: ["integrations"], required_integrations: ["gmail"], system_prompt_fragment: "...")` persists all three.
- [ ] `skill.dependencies_missing_for(agent, ["gmail"])` returns `{ capabilities: [...], integrations: [] }`.
- [ ] `SkillBundle.create!(slug: "outbound-sales", skill_slugs: [...], capability_overrides: {...}).install_on(agent)` enables skills + merges caps.
- [ ] Skill with `system_prompt_fragment` → agent's system prompt has a "Skill-specific guidelines" section with that text.

## Agent deployment per machine (commits pending)

- [ ] `AGENT_PROVISIONER` env unset → creating an agent is a no-op for provisioning (dev default, no-op NullBackend).
- [ ] `AGENT_PROVISIONER=local` → `Instance.create!(provider: "local")` row with status=running.
- [ ] `AGENT_PROVISIONER=fly` + `FLY_API_TOKEN` set → `POST /apps/alchemy-agent-<id>/machines` call succeeds; instance row captures machine_id + private_ip.
- [ ] `AGENT_PROVISIONER=hetzner` + `HETZNER_API_TOKEN` set → Hetzner server created with rendered cloud-init in user_data.
- [ ] Agent delete → `AgentProvisioner.terminate_for` fires → machine destroyed on provider → instance row status=terminated.
- [ ] `POST /api/agent_instances/ready` with body `{employee_id: N, public_ip: "1.2.3.4"}` + `X-Engine-Secret` header → instance flips to status=running + records ip.
- [ ] Bad secret → 401.
- [ ] `docker build -t alchemy-engine:test .` in engine repo succeeds (Dockerfile smoke).
- [ ] `docker compose up -d` from engine repo brings up engine + camofox; both containers healthy.
- [ ] `/agents/agt_.../screen` page renders; with no instance it shows "No machine yet" placeholder.
- [ ] With a running Fly machine it renders the noVNC iframe pointing at `<public_ip>:6080`.

## Model picker + capability copy (commit `39240e8`)

- [ ] `/agents/new` Provider dropdown lists Anthropic / OpenAI / Google / OpenRouter.
- [ ] Model dropdown under Anthropic lists Opus 4.7, Opus 4.6, Sonnet 4.6, Sonnet 4, Haiku 4.5 with one-line hints per model.
- [ ] Switching Provider resets Model to that provider's default.
- [ ] Capability descriptions on both `/agents/new` and `/agents/agt_.../edit` read as plain English, not tool names.
- [ ] Knowledge-base capability in edit shows threshold + top-k with tuning hints when enabled.
