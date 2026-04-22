# Integrations setup

Alchemy uses [Composio](https://composio.dev) to host and broker third-party integrations (Gmail, Notion, Slack, GitHub, etc.). The Rails `/integrations` page drives OAuth; the engine loads the matching tool schemas at runtime and executes tool calls against the user's connected accounts.

This doc walks through connecting your first integration (Gmail). The same flow works for every curated service — Notion, Slack, GitHub, Airtable, etc.

---

## Prerequisites

- A running Rails app (`bin/rails s`) on `http://localhost:3200`.
- A running engine (`bun run src/main.ts` in `alchemy_engine/`) on `http://localhost:3300`.
- A Composio account at [app.composio.dev](https://app.composio.dev).

---

## Step 1 — Get a Composio API key

1. Log into [app.composio.dev](https://app.composio.dev).
2. Go to **Developers → API Keys → Create new key**.
3. Copy the key (starts with `comp_…`).

## Step 2 — Configure the Gmail auth_config in Composio

Every toolkit that uses OAuth needs an `auth_config` registered in the Composio dashboard before users can connect. The fastest path uses Composio's managed Google OAuth client:

1. In the Composio dashboard: **Apps → Gmail**.
2. Click **Set up auth**.
3. Choose **OAuth (Composio-managed)** — good for testing and side projects. No additional credentials needed.
4. Save. The dashboard now shows `auth_config_id` starting with `ac_…`.

> **Production note.** For a real multi-tenant deploy, create your own Google OAuth 2.0 client in Google Cloud Console, add your domains to the consent screen, then choose **OAuth (bring your own client)** in Composio and paste the client_id/client_secret. The Composio-managed flow is fine for dev.

Repeat for every service you want to expose (Notion, Slack, GitHub, etc.).

## Step 3 — Set the API key in both services

**Rails** — `alchemy/.env`:

```
COMPOSIO_API_KEY=comp_...
```

**Engine** — `alchemy_engine/.env`:

```
COMPOSIO_API_KEY=comp_...
COMPOSIO_TIMEOUT_MS=5000
```

Restart both. The engine logs `Tool embeddings: 25 toolkits indexed` on boot — that confirms it's ready.

## Step 4 — Verify

```
cd alchemy
bin/rails integrations:check
```

Expected output:

```
✓ COMPOSIO_API_KEY set
✓ Composio API reachable (N auth_configs registered)
✓ gmail (auth_config_id=ac_...)
✗ notion (not configured in Composio dashboard — skip or set up)
...
Org #1 (acme): 0 active connections
```

If you see `✗` for a service you expected to have set up, go back to Step 2 for that service.

## Step 5 — Connect your Gmail account

1. Open `http://localhost:3200/integrations` in the browser.
2. Click **Connect** on the Gmail row.
3. A Composio OAuth popup opens in a new window. Approve with your Google account.
4. The popup closes; the Gmail row flips from **Disconnected** to **Connected**.
5. Rerun `bin/rails integrations:check` — output now shows `Org #1 (acme): 1 active connection: gmail`.

## Step 6 — Test with the agent

Open the agent's chat tab (`/agents/agt_.../`) and send:

> "Summarize my 5 most recent Gmail inbox messages."

Expected engine log sequence:

```
[INFO] Tool routing: gmail (layer1=-, layer2=gmail, available: gmail)
[INFO] MCP servers registered: recall, send-media, scheduling, tasks, integrations, composio
[INFO] mcp__composio__GMAIL_FETCH_EMAILS called
```

Response: the agent cites real inbox contents. Open `/ops/runs/<latest-id>` — the Timeline tab shows the `GMAIL_FETCH_EMAILS` span; the Meta row lists `toolkits: gmail`.

---

## Repeat for Notion

Identical flow:

1. Composio dashboard → **Apps → Notion → Set up auth → OAuth (Composio-managed)**.
2. Rerun `bin/rails integrations:check` → expect `✓ notion`.
3. `/integrations` → **Connect** Notion → approve.
4. Ask the agent: *"Create a Notion page in my workspace with a summary of today."*

---

## Curated toolkit list

Alchemy pre-curates tool subsets for these services (loaded selectively by keyword match instead of all-at-once to save tokens):

| Toolkit | Curated tools |
|--------|---------------|
| `gmail` | `GMAIL_SEND_EMAIL`, `GMAIL_FETCH_EMAILS`, `GMAIL_CREATE_DRAFT`, `GMAIL_SEARCH`, `GMAIL_REPLY_TO_EMAIL`, `GMAIL_GET_EMAIL` |
| `notion` | `NOTION_CREATE_PAGE`, `NOTION_QUERY_DATABASE`, `NOTION_UPDATE_PAGE`, `NOTION_SEARCH`, `NOTION_APPEND_BLOCKS` |
| `googlesheets` | `GOOGLESHEETS_CREATE_GOOGLE_SHEET1`, `GOOGLESHEETS_BATCH_UPDATE`, `GOOGLESHEETS_BATCH_GET`, `GOOGLESHEETS_APPEND`, … |
| `github` | `GITHUB_CREATE_ISSUE`, `GITHUB_CREATE_PR`, `GITHUB_LIST_REPOS`, `GITHUB_GET_FILE`, `GITHUB_SEARCH_CODE`, … |
| `slack` | `SLACK_SEND_MESSAGE`, `SLACK_LIST_CHANNELS`, `SLACK_SEARCH_MESSAGES`, `SLACK_UPLOAD_FILE`, … |

Full list lives in `alchemy_engine/src/integrations/curated.ts`. Services without a curated list load all tools alphabetically (fine for testing, heavy on tokens).

---

## Troubleshooting

### "Connect" button does nothing / popup closes immediately

Most likely cause: the auth_config isn't set up in the Composio dashboard for that service.

```
bin/rails integrations:check
```

Look for `✗ gmail (not configured in Composio dashboard)`. Go back to Step 2.

If the check passes but OAuth still fails, tail Rails logs and click Connect again — you should see `Composio: auth_config for gmail = ac_…`. If you see `= NOT FOUND`, the API key in `.env` is wrong or was rotated.

### Integration row stays `pending`

The OAuth popup completed but the callback to `/integrations/callback` never fired. Common causes:

- **Browser popup blocker** — allow popups for `localhost:3200`.
- **Composio callback URL misconfigured** — in the Composio dashboard, make sure the redirect_uri matches `http://localhost:3200/integrations/callback` (dev) or your WEBHOOK_BASE_URL (prod).
- **Wrong org** — if you're logged in as a different user, the callback's `current_user.organization` differs from the `state` param's org.

### Agent doesn't call Gmail tools

The agent has `search_integrations` and the composio toolkit loaded but won't actually call `GMAIL_FETCH_EMAILS`. Usually a tool-routing issue.

Diagnostic: set `TOOL_ROUTING=all` in `alchemy_engine/.env` and restart engine. The agent now sees every connected toolkit unconditionally. If it calls Gmail now, the issue was the keyword matcher in `router.ts`. Back to `TOOL_ROUTING=smart` for prod.

Second most common cause: the user's message doesn't mention gmail/inbox/email/reply. The embedding-based router uses a 0.3 cosine similarity cutoff. "Check what's new" → too vague, matches nothing. "Check my inbox" → matches gmail.

### "Composio API unreachable — try again in a minute"

Composio API timed out. The controller surfaces this as a friendly flash alert (vs 500) after the hardening in `integrations_controller.rb`. Retry; if persistent, check Composio status page.

### Connection shows `Expired` / agent fails auth

Composio-managed OAuth tokens refresh automatically. If the toolkit config changed (new scopes, revoked Google app), the connection flips to `expired` on next probe. Click **Disconnect** then **Connect** to re-run OAuth.

---

## What Composio does and doesn't do

**Does:**
- Hosts OAuth flows for 250+ services.
- Normalizes tool schemas across services.
- Rotates tokens automatically.
- Scopes credentials per user (`user_id = "org_<numeric_id>"` — org-level scoping, all agents in the org share connections).

**Doesn't:**
- Cache results — every tool call hits the real service.
- Proxy quota — your Gmail rate limits still apply.
- Per-agent isolation — if org A has Gmail connected, every agent in org A can use it. If you need per-agent separation, file a feature request or partition by organization.
