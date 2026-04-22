# Deploy

Alchemy has two processes to deploy together:

1. **Rails** (this repo) — web + Sidekiq, backed by Postgres + Redis.
2. **Engine** (`../alchemy_engine`) — one Bun process per agent, connects to the same Postgres + Redis.

The Rails app ships with a Kamal config (`config/deploy.yml`). The engine is not containerized by default; it's usually deployed alongside as a systemd service or separate Kamal app.

---

## Prerequisites

- A server (any Linux VM with Docker) reachable over SSH.
- A registry (Docker Hub, GHCR, AWS ECR, DigitalOcean, etc.).
- Managed Postgres + Redis, or self-hosted on the same box.
- Domain pointed at the server, and `WEBHOOK_BASE_URL` set to the HTTPS public URL.

## Secrets you'll need

Copy `.env.example` → `.env` locally, fill in everything. The values that matter in prod:

| Variable | Purpose |
|---|---|
| `RAILS_MASTER_KEY` | Decrypts `config/credentials.yml.enc` |
| `DATABASE_URL` | Production Postgres |
| `REDIS_URL` | Production Redis |
| `ENGINE_URL` | Where Rails reaches the engine gateway, usually `http://engine:3300` via Docker network |
| `ENGINE_API_SECRET` | Shared secret, must match engine `.env` |
| `PREFIXED_IDS_SALT` | Fixes the encoding of prefix_ids across secret_key_base rotations |
| `COMPOSIO_API_KEY` | Integrations OAuth |
| `AWS_*` | SES email |
| `TWILIO_*` | WhatsApp/SMS |
| `SENTRY_DSN` | Error tracking (optional but recommended) |
| `BETTERSTACK_SOURCE_TOKEN` | Log shipping (optional) |
| `WEBHOOK_BASE_URL` | Public URL for SES/Twilio webhooks |

Kamal pulls secrets from `.kamal/secrets` (plain env file, gitignored). Populate it from your `.env`:

```bash
cp .env .kamal/secrets
# (delete anything Kamal-specific you don't want there)
```

---

## Config checklist (`config/deploy.yml`)

Edit these in order. Defaults are placeholders.

1. `service:` — set to a unique service name (e.g. `alchemy-prod`).
2. `image:` — your registry path, e.g. `yourname/alchemy`.
3. `servers.web:` — the VM's public IP.
4. `servers.job:` — uncomment + add same IP (or separate box) to run Sidekiq.
5. `proxy.host:` — your public domain.
6. `registry:` — credentials for your registry (username + password token).
7. `builder.arch:` — `amd64` unless your target is ARM.
8. `env.secret:` — already covers the main secrets; add any extras from the table above.

### Adding Sidekiq

In `servers:`:

```yaml
job:
  hosts:
    - <your-ip>
  cmd: bundle exec sidekiq
```

### Solid Queue vs Sidekiq

This repo uses Sidekiq (see `Gemfile`). Don't switch to Solid Queue unless you also migrate the queue configuration — Rails 8 ships with Solid Queue but Alchemy's job patterns target Sidekiq.

---

## First deploy

```bash
# 1. Build + push + start
kamal setup

# 2. Migrate
kamal app exec 'bin/rails db:migrate'

# 3. Optional — run the merge rake on fresh data
kamal app exec 'bin/rails merge:internal_conversations'

# 4. Smoke test
kamal app logs --follow
# In another shell:
curl https://your-domain/up   # should return 200
```

## Subsequent deploys

```bash
git push
kamal deploy
```

Kamal does zero-downtime swap (healthcheck + proxy rollover) automatically. Rollback:

```bash
kamal rollback <previous-version>
```

---

## Engine deployment (separate from Kamal)

The engine is agent-specific — one Bun process per agent, each reading the same Postgres. Don't run multiple replicas of the same `EMPLOYEE_ID`; the BullMQ queue doesn't like it.

### Systemd (simplest)

Create `/etc/systemd/system/alchemy-engine@.service`:

```ini
[Unit]
Description=Alchemy engine for agent %i
After=network.target

[Service]
Type=simple
User=alchemy
WorkingDirectory=/srv/alchemy_engine
EnvironmentFile=/srv/alchemy_engine/.env
Environment=EMPLOYEE_ID=%i
ExecStart=/usr/local/bin/bun run src/main.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Start per-agent engines:

```bash
systemctl enable --now alchemy-engine@1
systemctl enable --now alchemy-engine@2
# etc.
```

Logs:

```bash
journalctl -u alchemy-engine@1 -f
```

### Docker (alternative)

If you prefer containers, add a second Kamal app pointing at the engine repo. Use `--role engine-2` and set `EMPLOYEE_ID=2` per instance. Keep Redis + Postgres URLs pointing at the same cluster.

---

## Dev ↔ Prod differences

| Concern | Dev | Prod |
|---|---|---|
| Engine | `bun run src/main.ts` in one terminal | systemd unit per agent |
| Webhooks | ngrok → `http://localhost:3200` | `WEBHOOK_BASE_URL=https://your-domain` |
| Composio callbacks | `http://localhost:3200/integrations/callback` | `https://your-domain/integrations/callback` (update in Composio dashboard) |
| Twilio webhook URLs | ngrok | `https://your-domain/webhooks/whatsapp`, `/sms` |
| SES inbound | No local equivalent (use a staging domain) | Set up via channel config + SES receipt rules |
| Prefix ID salt | Auto-falls-back to `secret_key_base` | Set `PREFIXED_IDS_SALT` explicitly so rotations don't change URLs |

---

## Post-deploy smoke tests

1. Log in, land on `/`.
2. Click an agent → URL should show `/agents/agt_…`.
3. `bin/rails integrations:check` — Composio reachable, auth_configs listed.
4. Connect Gmail via `/integrations`.
5. Send a test message through the web chat → agent replies.
6. `kamal app logs` should show the engine's `Config synced` after editing the agent.
7. Check `/ops/runs/<id>` loads.

Reminder: the manual test checklist in `docs/testing-checklist.md` covers the full surface.

---

## Known ops caveats

- **Composio `user_id = "org_<numeric>"`** is load-bearing. A DB restore from dev would re-key orgs and disconnect every live OAuth account. If restoring prod data, do it atomically.
- **BullMQ queue key `employee-<numeric>`** — changing `EMPLOYEE_ID` for an agent orphans in-flight jobs. Don't re-number live agents.
- **Engine restart time** — Telegram long-poll takes up to 30s to drain on `/sync`; deploys that bounce the engine cause a one-time latency bump.
- **Prefixed_ids salt** — once set in prod, don't rotate. URLs in the wild would break.
