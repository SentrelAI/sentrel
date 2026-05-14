# Monorepo merge: bringing `alchemy_engine` into `alchemy`

This is the procedure to fold the TypeScript engine sidecar (`../alchemy_engine`) into the Rails app (`./`) as a subdirectory while preserving full git history. After the merge, the engine lives at `engine/` and CI / kamal / Dockerfile / bin/setup all drive both halves from one repo.

## Why monorepo

Today: every change that crosses the wire (a new MCP tool, a new engine endpoint Rails calls, a shared payload shape) requires two PRs across two repos and two deploys. The engine's `/api/*` endpoints and Rails' `/api/*` callbacks share a contract that is silently broken when one side ships without the other.

After: one branch, one PR, one deploy, one tagged release pair. Schema migrations + the engine code that reads the new columns ship together.

## Procedure (run from `~/Workspace/code/alchemy-ai/alchemy`)

```bash
# 1. Pull the engine's history into a temporary remote.
git remote add engine ../alchemy_engine
git fetch engine

# 2. Move every engine file under `engine/` *inside the engine repo's history*
#    so the merge below lands cleanly at the right path. Use git-filter-repo
#    (not filter-branch — too slow + buggy for this size).
#    First, install: `brew install git-filter-repo`
#
#    Run inside the ENGINE repo:
cd ../alchemy_engine
git filter-repo --to-subdirectory-filter engine
cd ../alchemy

# 3. Refetch with the new history, then merge with --allow-unrelated-histories.
git fetch engine
git merge engine/main --allow-unrelated-histories -m "merge: import alchemy_engine into engine/"

# 4. Remove the temporary remote.
git remote remove engine
```

After step 4, `git log -- engine/` shows the full engine history under the new path.

## Post-merge follow-ups (separate PRs)

### A. Unified `bin/setup`

`bin/setup` is currently Rails-only. Append after `npm install` (line 17):

```ruby
puts "\n== Installing engine dependencies =="
Dir.chdir("engine") { system!("bun install") }

puts "\n== Linking engine env from Rails =="
unless File.exist?("engine/.env.development")
  FileUtils.cp "engine/.env.example", "engine/.env.development" if File.exist?("engine/.env.example")
end
```

### B. Unified `Procfile.dev`

Add to `Procfile.dev`:

```
engine: cd engine && bun run dev
```

(Already in the merge target — confirm `bin/dev` picks it up via foreman.)

### C. `Dockerfile` strategy

The Rails container and the engine container have different bases (Ruby 3.4 vs Bun 1.1). Two clean options:

1. **Two-stage Dockerfile** (`Dockerfile.web` for Rails, `Dockerfile.engine` for engine). Kamal already supports per-role Dockerfiles.
2. **Multi-stage single Dockerfile** with a `FROM oven/bun AS engine` stage. Final web image bundles a `dist/` copy of the engine for sidecar mode, or pushes a separate `:engine` tag at build time.

Recommended: **option 1** — fewer surprises, mirrors today's split. Add `engine/Dockerfile` (move existing `alchemy_engine/Dockerfile` content here).

### D. `config/deploy.yml` (kamal) update

Add an `engine` role pointing at `engine/Dockerfile`:

```yaml
servers:
  web:
    hosts: [...]
  engine:
    hosts: [...]
    cmd: bun src/main.ts
    options:
      restart: unless-stopped
```

> Per-agent engines aren't deployed via kamal — they're Fly Machines provisioned by `AgentProvisioner`. The kamal `engine` role is only for the shared bridge process (Redis pub/sub fan-in, billing proxy). Keep separation explicit in `docs/deploy.md`.

### E. CI

Add a parallel job to `bin/ci`:

```bash
( cd engine && bun install --frozen-lockfile && bun test ) &
( bundle exec rspec ) &
wait
```

### F. References to fix

After the merge, audit for `../alchemy_engine` hardcoded paths:

```bash
grep -rn "alchemy_engine" .
```

Likely hits: `docker-compose.yml`, `docs/per-agent-hosting.md`, `script/*.sh`.

## Rollback

If anything goes wrong before pushing:

```bash
git reset --hard origin/main
```

After push: revert the merge commit. The engine repo's filter-repo step is destructive locally but the original is preserved at the GitHub remote — re-clone if needed.

## Why not git subtree

`git subtree add --prefix=engine ../alchemy_engine main` is the one-liner alternative. It works but flattens engine history into a single squash-style commit by default; `--squash` is its only good mode for this case. Filter-repo + merge preserves per-file blame, which matters because the engine has 6+ months of dense MCP-tool history.
