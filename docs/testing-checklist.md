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
- [ ] Run full suite (`bundle exec rspec`) in CI before merge.
