# Slack integration — plan

Status: planning. No code yet. The user explicitly asked for a proper plan before any implementation.

## Today

- `config/channels.yml`: `slack:` block defined with `coming_soon: true`. UI hides the connect form.
- `WebhooksController#slack`: receives `event_callback`, validates `url_verification`, ignores bot messages, enqueues a user message to the matching agent by `team_id`. No outbound code.
- `composio_supported.rb`: Slack listed in the integrations catalog, so an org can connect Slack as a *Composio integration* (different lane — exposes Slack tools to agents, but does not host the agent IN Slack).

The gap: **inbound webhook is half-wired; outbound is nonexistent; OAuth install flow is nonexistent; per-agent workspace mapping is undefined.**

## The two Slack lanes (don't conflate them)

| Lane | Purpose | Status |
|---|---|---|
| **Slack-as-channel** (this plan) | Agent IS a Slack bot in user's workspace. Inbound DM / mention → agent. Agent replies via `chat.postMessage`. Same role as email / Telegram. | Coming soon (channels.yml, no impl). |
| **Slack-as-integration** (already works) | Org connects Slack via Composio. Agents call Slack tools (`SLACK_POST_MESSAGE`, etc.) on demand. User talks to the agent on web / email; the agent posts to Slack on their behalf. | Implemented via existing Composio path. |

Both can coexist — e.g. an HR agent connects Slack-as-channel for direct DMs *and* uses Slack-as-integration to post announcements in #all-hands. The two lanes don't share auth tokens (channel = bot install; integration = OAuth via Composio).

## Scope of this plan: Slack-as-channel

### Architecture

```
Slack workspace               Rails                            Engine
─────────────────             ──────────────────────           ─────────
DM to bot ──────────► /webhooks/slack
                          │
                          ▼ verify signature
                       find ChannelConfig (channel_type="slack",
                            config.team_id = body.team_id)
                          │
                          ▼ create Message + enqueue inbox job
                       Redis "agent-<id>-inbox" ──────────► engine
                                                              │
                                                              ▼ runs LLM, hits tools,
                                                              calls back /api/send_slack_message
                                                              │
                              POST /api/send_slack_message ◄──┘
                          │
                          ▼ slack.chat.postMessage
                       OK ─────────────────────────────► Slack workspace
```

### Components to build

#### 1. OAuth install flow (Slack-as-channel app)

- Register a Slack app at api.slack.com/apps. Manifest below.
- New route: `GET /slack/install` — redirects to Slack's OAuth consent URL.
- New route: `GET /slack/oauth/callback` — exchanges `code` for `access_token` + `bot_user_id` + `team.id`.
- Persist as a `ChannelConfig` row:
  - `channel_type = "slack"`
  - `config = { team_id, team_name, bot_user_id, app_id }`
  - `secret_config = { bot_token, signing_secret }` — encrypted at rest (use `encrypts` + Rails 7 attr encryption; same pattern as `Credential#encrypted_value`).
- New nullable column `channel_configs.secret_config :text` if not present. Today `config` is plaintext jsonb and shouldn't hold tokens.

#### 2. Inbound webhook hardening

- Verify request signature (HMAC-SHA256 of `v0:{timestamp}:{body}` with `signing_secret`). Reject if older than 5 min (replay protection).
- Support event types beyond `message`: `app_mention`, `app_home_opened` (for a Home tab), `message.im` (DM channel).
- De-dupe on `event_id` — Slack retries on 3 timeout, idempotency is on us. Use Redis SET with TTL.
- Convert Slack user IDs to display names via `users.info` (cached 1h in Redis).

#### 3. Outbound `Slack::OutboundSender`

- Mirrors `Email::OutboundSender` shape.
- `Slack::OutboundSender.new(agent: ...).deliver(channel: ts: text: blocks:)` → `chat.postMessage` API call with the agent's bot_token.
- Handle threading: respect `thread_ts` on replies.
- Handle rich messages: blocks API for buttons / structured content. For MVP, plaintext only; blocks come in v2.
- Audit log row per send (existing `AuditLog` pattern).

#### 4. `/api/send_slack_message` endpoint

- New `Api::SlackMessagesController#create`, engine-callable, `X-Engine-Secret`.
- Params: `agent_id`, `channel`, `text`, optional `thread_ts`.
- Looks up ChannelConfig, calls `Slack::OutboundSender`, returns `{ ok: true, ts: "..." }`.
- Approval gate: if `agent.permissions["send_slack_message"] == "draft"`, create a `PendingApproval` instead of sending, return `{ pending: true, approval_id }`.

#### 5. Engine: Slack send tool

- New `engine/src/tools/slack.ts` registering a `slack.post` MCP tool.
- Implementation calls Rails `/api/send_slack_message` (engine never holds bot tokens — single source of secrets).
- Surfaced when `agent.capabilities.slack_channel?.enabled === true`.

#### 6. UI

- `app/frontend/pages/agents/[id]/channels` — drop `coming_soon: true` from Slack only after parity is real.
- Slack card renders an "Install in Slack" button → `/slack/install?agent_id=...`.
- Post-install card shows: connected workspace name, bot user, "Reinstall" + "Disconnect" actions.
- Channel-specific permissions: send Slack message → auto / draft / never (mirrors `send_email`).

### Slack app manifest (for api.slack.com/apps)

```yaml
display_information:
  name: Alchemy Agents
  description: Run AI teammates inside your Slack workspace
features:
  bot_user:
    display_name: Alchemy
    always_online: true
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - im:history
      - im:read
      - im:write
      - users:read
      - users:read.email
      - channels:history   # optional, gated behind upgrade
      - groups:history     # same
settings:
  event_subscriptions:
    request_url: https://<your-domain>/webhooks/slack
    bot_events:
      - app_mention
      - message.im
      - app_home_opened
  org_deploy_enabled: false
  socket_mode_enabled: false
```

### What we explicitly defer

- **Slash commands** (`/ask <agent>`) — second sprint. Easy to add: extra route `/webhooks/slack/commands`, route by command name.
- **Block Kit modals + interactive components** — needed for approval prompts inside Slack. Second sprint.
- **Multi-workspace sharing of a single agent** — for v1, one ChannelConfig = one workspace = one agent. A user installing the same agent in two workspaces creates two ChannelConfigs.
- **Slack Connect (external workspaces)** — out of scope.
- **Enterprise Grid org-deploy** — out of scope.

## Open questions before we code

1. **Are bot tokens long-lived?** Slack rotates them only via reinstall. We can treat them as long-lived but build the `Slack::OutboundSender` to handle `token_revoked` errors gracefully (notify org admin, flip ChannelConfig to `status = "needs_reauth"`).

2. **DMs vs channel messages — same agent or different?** Decision needed: should the agent reply in-thread when @mentioned in a public channel, or always DM the user? For v1: respect channel — DM in DM, in-thread on `app_mention`.

3. **Rate limiting.** Slack's `chat.postMessage` is Tier 4 (~1/sec sustained per workspace). The engine can spam — need a token-bucket per `team_id` in Redis on the outbound side. Same pattern as our email send queue.

4. **Approval UI inside Slack.** When an agent's `send_email` is gated at `draft`, the user sees the pending approval at `/pending_approvals`. Should Slack-channel agents push approval requests *into Slack itself* via Block Kit? Probably yes — but that's the second-sprint Block Kit work.

5. **Are we exposing one shared Alchemy Slack app, or do orgs BYO their own app?** Affects deploy: shared = single approved Marketplace app; BYO = each org runs Slack app creation themselves. Shared is much better UX, but we need Slack Marketplace approval (~2-4 weeks). For dogfooding: shared dev app first, public-listed app once Marketplace approves.

## Estimated effort

- OAuth install + signing verification: 1 day
- Inbound webhook + dedup + display-name hydration: 0.5 day
- `Slack::OutboundSender` + `Api::SlackMessagesController`: 0.5 day
- Engine MCP tool + capability gate: 0.5 day
- UI (install button + connected card + permissions): 1 day
- Approval flow integration: 0.5 day
- E2E smoke + Marketplace submission docs: 0.5 day

**Total: ~4.5 days for Slack-as-channel v1.** Add ~3 days for slash commands + Block Kit in v2.

## Next step

User approves this plan, then we start with the OAuth install flow (smallest piece that proves end-to-end auth before we wire any messaging).
