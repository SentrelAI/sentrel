# Alchemy → Sentrel: infra rename migration

Your **user-facing brand is already "Sentrel"** (sentrel.ai, sentrel-nango, all
UI copy). What still says "alchemy" is the **internal codename** — and every one
of those is **infra-coupled**, so renaming them is a *coordinated migration*,
not a find-and-replace. Done wrong, deploys + live connections break. This doc
is the ordered playbook.

> **Execution status (updated):**
> - ✅ Cosmetic example/comment strings renamed to Sentrel (shipped).
> - ✅ **Phase 5 (billing-proxy)** — Sentrel↔OCBrand sanitization pairs added & shipped (`079ced2`).
> - ✅ **Local working folder** renamed `alchemy-ai/alchemy` → `alchemy-ai/sentrel`.
> - ⏳ **Phase 0 (repo transfer)** — reserved for you to run (irreversible org transfer; classifier-blocked for the assistant). Command below.
> - ⏳ **Phases 1–4** — production-coupled (image republish, Rails module + cable cutover, DB rename, Fly apps). NOT auto-run — they need your trigger + a maintenance window. Commands below.
>
> Everything still labelled ⏳ below is **deliberately not auto-run** — execute it yourself.

## The infra-coupled inventory

| What | Where | Renaming it… |
|---|---|---|
| **Rails app module** `Alchemy::Application` | `config/application.rb` + generated `routes/index.*` | Touches the Ruby module namespace — pervasive; do with the whole app, test boot. |
| **DB names** `alchemy_{production,development,test}` | `config/database.yml` | Requires creating/renaming the actual Postgres databases + repointing `DATABASE_URL`. |
| **Kamal service / image** `service: alchemy`, `image: parsedev/alchemy` | `config/deploy.yml` | New GHCR image path; re-tag + update the deploy + GitHub Actions secrets. |
| **GHCR images** `parsedev/alchemy`, `ghcr.io/qubitam/alchemy-engine` | `deploy.yml`, `engine/fly.toml`, `.github/workflows/*` | Re-tag/republish images under the SentrelAI namespace. |
| **Fly agent apps** `alchemy-{env}-agent-<id>` | `engine/fly.toml`, the provisioner | New Fly apps per agent; existing agents keep old names until reprovisioned. |
| **ActionCable prefix** `alchemy_{development,production}` | `config/cable.yml` | Changing it drops in-flight WS channels at cutover — do during a maintenance window. |
| **AWS ElastiCache** `alchemy-cache-1` | env/secret (`REDIS_URL`) | An AWS resource name — rename the cluster or just leave it (it's invisible to users). |
| **GitHub repo** `ParseDev/double.md` | remote | Transfer to `SentrelAI/sentrel` (GitHub redirects old URLs). |
| **Billing-proxy sanitization pair** `["Alchemy","OCPlatform"]` | `engine/src/proxy/anthropic-billing-proxy.ts` | Functional — add `["Sentrel","OCPlatform"]` so the new brand is sanitized too. |

## Recommended order (lowest-risk first)

**Phase 0 — repo (safe, do anytime)**
```sh
# Transfer the repo to the SentrelAI org (GitHub keeps redirects):
gh repo transfer ParseDev/double.md SentrelAI    # or rename in Settings → sentrel
# Update the local remote afterward:
git remote set-url origin git@github.com:SentrelAI/sentrel.git
```

**Phase 1 — images + deploy names** (new infra, old keeps running)
1. Update GitHub Actions to build/push under `ghcr.io/sentrelai/sentrel` (backend) and `ghcr.io/sentrelai/sentrel-engine` (engine).
2. `deploy.yml`: `service: sentrel`, `image: sentrelai/sentrel`.
3. `engine/fly.toml`: `image = ghcr.io/sentrelai/sentrel-engine:latest`.
4. Push → verify the new image builds → `kamal deploy`. (Kamal creates a fresh service; tear down `alchemy` after the new one is green.)

**Phase 2 — Rails module + cable prefix** (code; test boot)
1. `config/application.rb`: `module Sentrel` (was `Alchemy`). Regenerate `js-routes` (`bin/rails js:routes` or equivalent).
2. `config/cable.yml`: `channel_prefix: sentrel_{env}`. **Maintenance window** (drops live WS at cutover).
3. `bin/rails zeitwerk:check` + full spec suite before deploy.

**Phase 3 — databases** (highest risk; backup first)
1. Backup. Create `sentrel_production` (or `ALTER DATABASE alchemy_production RENAME TO sentrel_production` with no active connections).
2. Repoint `DATABASE_URL`. Deploy.

**Phase 4 — Fly agent apps + cache** (gradual)
- New agents provision as `sentrel-{env}-agent-<id>`. Existing agents keep `alchemy-*` names until reprovisioned — roll them when convenient.
- ElastiCache: rename the cluster or leave it (cosmetic, internal).

**Phase 5 — billing-proxy**
- In `engine/src/proxy/anthropic-billing-proxy.ts`, add `["Sentrel","OCPlatform"]` (and the reverse) alongside the existing Alchemy pair so the new brand string is sanitized from the LLM billing proxy.

## Why this isn't a sed
`alchemy` is the *deployment identity* (image tag, kamal service, DB, Fly apps, cache, WS prefix). A blind rename desyncs the code from the running infrastructure → the next deploy can't find its image/DB/service. Each phase above keeps old + new side-by-side until the new one is verified, then retires the old.

## The staged cutover branch — `chore/sentrel-rename-cutover`

The **code-only** parts of Phases 1–2 are pre-staged on this branch (not merged,
not deployed). It contains exactly:

| File | Change |
|---|---|
| `backend/config/deploy.yml` | `service: alchemy → sentrel`, `image: parsedev/alchemy → sentrelai/sentrel` |
| `backend/config/application.rb` | `module Alchemy → module Sentrel` (only ref; js-routes comment regenerates) |
| `backend/config/cable.yml` | `channel_prefix: …_{development,production} → sentrel_…` |
| `engine/fly.toml` | engine image → `ghcr.io/sentrelai/sentrel-engine:latest` |
| `.github/workflows/engine-image.yml` | push base → `…/sentrel-engine` (owner auto-follows the repo transfer) |
| `.github/workflows/app-deploy.yml` | image refs in comments/summary → `sentrelai/sentrel` |

**Deploy preconditions (do these BEFORE merging/deploying the branch):**
1. Repo transferred to SentrelAI **and** Actions secrets re-added in the new org
   (esp. `KAMAL_REGISTRY_PASSWORD` with push rights to `ghcr.io/sentrelai/*`,
   `ENGINE_IMAGE = ghcr.io/sentrelai/sentrel-engine:latest`).
2. The `ghcr.io/sentrelai/sentrel` + `sentrel-engine` packages exist/are writable.
3. Phase 3 DB rename done (or `DATABASE_URL` still points at the old DB name — the
   app reads the name from the env URL, so the DB can lag the code).
4. **Maintenance window** — merging flips the cable `channel_prefix`, dropping live
   WebSocket channels at cutover. Run `bin/rails zeitwerk:check` + the full spec
   suite first (the module rename).

**Deliberately NOT in the branch (still manual / separate phase):**
- **Storage volumes** `alchemy_storage` (deploy.yml) + `alchemy_data` (fly.toml) —
  renaming them provisions *empty* volumes and orphans existing data. Migrate
  contents or leave the names.
- **DB names** (`database.yml`, CI `alchemy_test`, prod `DATABASE_URL`) — Phase 3,
  coupled to the actual Postgres rename.
- **Agent app template** `alchemy-{env}-agent-*` (fly.toml `app =`) — Phase 4,
  gradual; existing agents keep their names until reprovisioned.
- **SSH key path** `~/Downloads/alchemy_key.pem` (deploy.yml) — your local file.
- **Repo transfer + local folder** — folder already renamed to `…/sentrel`; repo
  transfer is the `gh api … transfer` command (run it yourself).
