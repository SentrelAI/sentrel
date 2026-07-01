# Templates ⇄ Bundles — Plan

> Goal: connect the public agent **bundles** (`agent.yaml` in `SentrelAI/agent-templates`)
> to the in-app **`/templates`** page, with a GitHub source field, so templates are
> open, inspectable, and repo-driven. Last updated 2026-06-30.

---

## The core decision (make this and everything follows)
**Bundles are the single source of truth for *official* templates. `/templates` is an imported, synced view of them.**

Why: today the same concept exists in **two formats** that drift apart —
- the **seed array** (`db/seeds/agent_templates.rb`, 36 Ruby hashes: CEO, Marketing Lead, …), and
- the **bundles** (`agent.yaml` folders: marketing, sdr, scheduler, bugfixer).

One format wins. **Pick bundles**, because they are: open + forkable on GitHub, the deploy unit (`npx agentmanifest deploy`), human-editable, and a community-contribution surface (PR a new template). The seed array is a closed Ruby blob nobody outside can read or contribute to.

> User-saved templates and Forge-generated templates stay as-is (org-owned, `source_url = null`). Only **official/system** templates come from bundles.

---

## Current state (3 sources of templates)
| Source | Where | Format | `source_url`? |
|---|---|---|---|
| Seed system templates (×36) | `db/seeds/agent_templates.rb` | Ruby hash | ✗ |
| Agent bundles (×4) | `SentrelAI/agent-templates` repo | `agent.yaml` | (the GitHub URL) |
| User-saved / Forge-generated | DB, runtime | `definition` jsonb | ✗ (org-owned) |

`/templates` (`TemplatesController#index`) renders `AgentTemplate.visible_to(tenant)`. Storage = `agent_templates` (metadata) + `agent_template_versions.definition` (jsonb config).

---

## Target architecture
```
SentrelAI/agent-templates (agent.yaml bundles)   ← SOURCE OF TRUTH (official templates)
        │  templates:import_bundles  (reuses agent_bundles/deployer parsing)
        ▼
agent_templates (system_template:true, source_url, source_ref)
 + agent_template_versions.definition (jsonb)
        │
        ▼
/templates  → "View on GitHub" link + one-click Deploy
        │  AgentTemplates::Installer (definition → live agent)
        ▼
   running agent
```
- **Edit `agent.yaml` in the repo → re-run import → `/templates` updates.** Repo wins for system templates (no in-app edits override).

---

## Data model change
Add two **nullable** columns to `agent_templates`:
- `source_url` (string) — canonical GitHub tree URL, e.g. `https://github.com/SentrelAI/agent-templates/tree/main/marketing`
- `source_ref` (string) — branch or pinned commit (`main` / SHA)

Nullable because only bundle-derived templates have a source. Surface `source_url` in `card_attributes` → **"View on GitHub"** on the template card + detail page.

---

## Bundle → template mapping (the conversion)
`agent.yaml` (+ files) maps 1:1 onto the template's `definition` / columns:

| `agent.yaml` | → AgentTemplate |
|---|---|
| `name` / `role` / `description` | `name` / `role` / `description` |
| `persona.identity/personality/instructions` (→ md files) | `identity_md` / `personality_md` / `instructions_md` |
| `model.id` | `suggested_model` (+ `suggested_provider`) |
| `skills/*` | embedded skill bundles + `suggested_skill_slugs` |
| `integrations` / MCP servers | `suggested_integrations` |
| `inputs` | `variables` |
| `goal`, `capabilities`, `channels`, `schedules` | `capabilities` (jsonb) + `definition` |
| (choose) | `category`, `icon` |
Reuse the parsing already in `agent_bundles/deployer.rb` (the server half of `npx agentmanifest deploy`) so there's no duplicate bundle-reader.

---

## Phased plan

### Phase 1 — Field + importer + load the 4 bundles  ← DO FIRST
1. **Migration:** add `source_url`, `source_ref` to `agent_templates`.
2. **`card_attributes`** exposes `source_url`; template card + detail page render a **"View on GitHub"** link when present.
3. **Rake task** `templates:import_bundles[/path/to/sentrel-agent-templates]`:
   - read each bundle dir → parse `agent.yaml` + persona + skills (reuse deployer) → build `definition`,
   - **upsert** a `system_template: true` `AgentTemplate` by slug, set `source_url`/`source_ref`, create a new `AgentTemplateVersion`,
   - idempotent (re-run = update, bump version on change).
4. Run it → `marketing` / `sdr` / `scheduler` / `bugfixer` appear on `/templates`, deployable, with GitHub links.
- **Outcome:** real, open bundles live on `/templates`. Mechanism proven. *(No sync yet — manual task.)*

### Phase 2 — Migrate the 36 seed templates → bundles
1. Use the **existing exporter** (`AgentTemplates::Exporter`: `AgentTemplate → bundle`) to dump the 36 seed templates as `agent.yaml` bundles.
2. Commit them to `SentrelAI/agent-templates` (now ALL official templates are bundles).
3. Re-run `import_bundles` → they come back in with `source_url` set.
4. **Retire** `db/seeds/agent_templates.rb` (the Ruby array). One format remains: bundles.
- **Outcome:** single source of truth. Every official template is an open, forkable bundle.

### Phase 3 — Repo-driven sync (automation)
1. A **GitHub Action** in `agent-templates` (on push to `main`) calls a Sentrel **sync endpoint** (X-Engine-Secret) → runs `import_bundles` for changed bundles.
   - *or* simpler: a scheduled `templates:sync` job that pulls the repo + imports.
2. Rule: **for `system_template` rows, the repo wins** — in-app edits to system templates are disabled (edit the bundle instead).
3. Pin via `source_ref` if you want to freeze a template at a commit.
- **Outcome:** edit `agent.yaml` → push → `/templates` updates itself. Templates managed like code.

---

## Strategic upside (worth stating)
**"Every Sentrel template is an open, inspectable, forkable bundle on GitHub."**
- **Trust:** templates aren't black boxes — read/audit the exact persona + skills before deploying. Pairs with the "real full-API ad ops" positioning.
- **Community:** outsiders can PR new templates to `agent-templates` → they flow onto `/templates`. A growth/marketplace flywheel for free.
- **Provenance:** `source_url` cleanly separates official (GitHub) from user/AI-generated templates.

---

## Open decisions
- **Where does the import read bundles from?** Phase 1: a **local checkout path** (simplest). Phase 3: GitHub Action → sync endpoint, or vendor `agent-templates` as a git submodule. Recommend: path-arg now, Action later.
- **Category/icon** aren't in `agent.yaml` today — either add optional `category:`/`icon:` keys to the bundle spec, or map by slug in the importer. Recommend: add them to the spec (keeps the bundle self-describing).
- **System-template edit lock** (Phase 3): confirm we disable in-app editing of `system_template` rows so the repo stays authoritative.

---

## Recommended next step
Build **Phase 1** on a branch: migration (`source_url`/`source_ref`) + `templates:import_bundles` task + the "View on GitHub" link. Run it to load the 4 bundles onto `/templates`. That proves the whole model with the least work; Phases 2–3 are follow-ons.

---

## Implementation status (PR `feat/templates-from-bundles`)
Handling the 9 confusion/improvement points:

| # | Point | Status |
|---|---|---|
| 1 | Clarify the 3 catalogs → connected pipeline | ✅ browse (`/use-cases`) → deploy (`/templates`) → source (bundles), now wired |
| 2 | Bundles = single source of truth | ✅ importer makes bundles authoritative for official templates; seed retirement = follow-up (row 5) |
| 3 | Bundles appear on `/templates` | ✅ `AgentTemplates::BundleImporter` + `templates:import_bundles`; 4 bundles imported as system templates |
| 4 | Source / "View on GitHub" | ✅ `source_url`/`source_ref` cols + `card_attributes` + link on card & detail |
| 5 | Retire the 36-entry seed array | ⏳ **follow-up** — export seed rows → bundles (`AgentTemplates::Exporter` exists) → commit to `agent-templates` → import → delete `db/seeds/agent_templates.rb`. Left out of this PR (bulk data + cross-repo; do deliberately) |
| 6 | Auto-sync | ✅ `templates:sync` (fetch public repo tarball → import). Automate via sidekiq-cron or a GitHub Action `repository_dispatch`. Action file: add to `SentrelAI/agent-templates/.github/workflows/` |
| 7 | `category`/`icon` in bundles | ✅ added to the bundle JSON schema + to all 4 bundles' `agent.yaml` (marketing/sales/ops/engineering) |
| 8 | System-template edit lock (repo wins) | ✅ `forbid_system_template!` blocks in-app update/destroy of `system_template` rows |
| 9 | `/use-cases` roles → deployable templates | ✅ roles enriched with `template_slug` on exact-slug match → deploy the real template; else generic flow |

### Run steps (post-merge)
1. **Seed the bundles onto prod `/templates`:** `rails templates:sync` (or `rails templates:import_bundles[<checkout>]`).
2. **Commit the bundle `category`/`icon` edits** to `SentrelAI/agent-templates` (they were added in the local checkout).
3. **Automate:** schedule `templates:sync` (sidekiq-cron) or wire a GitHub Action on push to the templates repo.

### Deliberately deferred
- **GitHub Action file** lives in the *other* repo (`agent-templates`), not here.

---

## Point 5 — seed → bundle migration (runbook)
The machinery to retire the Ruby seed catalog now exists and is verified (all 16 seed templates round-trip faithfully: skills, capabilities, model, variables, integrations).

**What was built (this stacked PR):**
- **Spec extension** (agent-bundle/v1): `builtin_skills` (slugs of built-in/platform skills the runtime already ships — `web-search`, `send-email`, …) + `capabilities` (feature toggles). These were the fidelity gaps that blocked a faithful migration — the seeds wire skills by slug and set capability toggles, neither expressible before.
- **`AgentTemplates::BundleExporter`** — the inverse of `BundleImporter`: an `AgentTemplate` row → an `agent.yaml` bundle dir (persona md + `builtin_skills`/`capabilities`/`inputs`/`integrations`; custom skills embedded as `skills/<slug>/SKILL.md`).
- **`BundleImporter`** now merges `builtin_skills` into `suggested_skill_slugs` + the definition.
- **Rake:** `templates:export_bundle[slug,outdir]` (one) and `templates:export_seeds[outdir]` (all seed slugs).
- **Spec:** `bundle_export_roundtrip_spec` — export → import reproduces the template.

**To finish the migration (the gated, mechanical steps):**
1. `bin/rails db:seed` (so the seed rows exist), then `bin/rails templates:export_seeds[tmp/bundles]`.
2. Review the generated bundles, copy into the `SentrelAI/agent-templates` repo, open a PR there. **Skip `sdr`** — already shipped as the `Sarah` bundle (see #47).
3. Once merged, `bin/rails templates:sync` re-imports them with `source_url` set.
4. **Then** delete `db/seeds/agent_templates.rb` (and its loader ref) in a final one-line PR — the seed rows are now sourced from bundles.

**Fidelity note:** seed `category` is preserved as-is; rows whose DB category isn't one of the 8 enum values export as `starter` (same as they render today — no regression). `suggested_manager_role` is not part of the bundle spec and is not carried (org-topology hint, not template-essential).
