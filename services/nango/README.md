# Self-hosted Nango (`sentrel-nango`)

Our OAuth / token / API-proxy layer, replacing Composio. Free self-host **Auth + Proxy** only
(no Functions/Syncs/Webhooks/MCP — those are Enterprise-gated and unused).

- **What Rails uses it for:** create Connect sessions (end-user OAuth), and proxy provider API
  calls (`/proxy/...`) with Nango injecting the fresh access token.
- **Private:** reachable at `sentrel-nango.internal:3003` (server) / `:3009` (Connect UI). The
  **Nango Secret Key** lives only in Rails (`NANGO_SECRET_KEY` kamal secret). The engine never
  talks to Nango — it round-trips through Rails `/api/nango_proxy`.

## Components

Nango server (this app) + **Postgres** (control plane + AES-encrypted provider creds) +
**Elasticsearch** (operation logs). Redis is NOT required for the Auth+Proxy tier.

## One-time deploy runbook

Run these yourself (authenticated `fly` CLI). In a Sentrel session you can prefix with `!`.

```bash
# 1. Create the app (no deploy yet)
fly apps create sentrel-nango --org scribemd-746

# 2. Postgres (control plane). Attach sets DATABASE_URL on the app.
fly postgres create --name sentrel-nango-db --org scribemd-746 --region iad \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 10
fly postgres attach sentrel-nango-db --app sentrel-nango
#   -> exposes DATABASE_URL; Nango reads NANGO_DATABASE_URL, so mirror it:
fly secrets set --app sentrel-nango \
  NANGO_DATABASE_URL="$(fly ssh console -a sentrel-nango -C 'printenv DATABASE_URL')"

# 3. Elasticsearch for logs. Either a Fly ES machine or an external ES URL.
#    Set the URL Nango should log to:
fly secrets set --app sentrel-nango ES_URL="https://<es-host>:9200" \
  NANGO_LOGS_ES_URL="https://<es-host>:9200"
#    (If you skip ES initially, set NANGO_LOGS_ENABLED=false in fly.toml [env].)

# 4. Required crypto + auth secrets
fly secrets set --app sentrel-nango \
  NANGO_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  NANGO_DASHBOARD_USERNAME="sentrel" \
  NANGO_DASHBOARD_PASSWORD="$(openssl rand -base64 24)"

# 5. Deploy
fly deploy --app sentrel-nango --config services/nango/fly.toml

# 6. Grab the Nango Secret Key from the dashboard (https://sentrel-nango.fly.dev,
#    log in with the dashboard creds above -> Environment Settings) and store it
#    in the Rails app as a kamal secret (GitHub Actions secret NANGO_SECRET_KEY),
#    then add NANGO_SECRET_KEY + NANGO_BASE_URL to backend/config/deploy.yml secrets.
```

## Rails wiring

- `NANGO_SECRET_KEY` (kamal secret) — server-to-server auth (Bearer) for `/proxy`, `/connect/sessions`, etc.
- `NANGO_BASE_URL` — `http://sentrel-nango.internal:3003` (private) for proxy/API calls from Rails.
- `NANGO_CONNECT_BASE_URL` — `https://sentrel-nango.fly.dev` (public) for the browser Connect UI.

## Health check

```bash
# From a Rails console / box on the private net:
curl -s http://sentrel-nango.internal:3003/health   # -> { "status": "ok" }
```
