# agentmanifest

The Agent Bundle spec (`agent-bundle/v1`) — the Dockerfile of AI agents.
A bundle is a directory: an `agent.yaml` manifest plus the persona files,
skills, and knowledge it references.

## Generate a bundle

```sh
npx @manifestagent/agentmanifest generate [output-dir]
```

An interactive wizard that asks everything needed to produce a complete
spec — name and mission, model, whether the agent needs its own mailing
address (email channel), which MCP servers and platform integrations it
uses, standing schedules, custom skills, knowledge docs, secret *names*
(never values), and permissions. It then scaffolds the bundle and
validates it.

At any prompt:

| You type           | What happens                                            |
| ------------------ | ------------------------------------------------------- |
| `skip`             | skip the current question                               |
| `remove scheduler` | drop a whole section — works mid-section or after the fact (`remove mcp`, `remove goal`, …) |
| `help`             | list these commands                                     |

The generated persona files (`personality.md`, `identity.md`,
`instructions.md`) are stubs — search for `TODO` and fill them in.

## Validate a bundle

```sh
npx @manifestagent/agentmanifest validate <bundle-dir> [--json]
```

Checks the manifest against the [JSON schema](schema/agent-bundle.v1.schema.json),
verifies every referenced file exists, and scans for secret *values*
(bundles may only declare secret names under `secrets[]`). It also checks
that every typed input's `default` satisfies its own type and rules, and
**warns** when a `{{token}}` is used but no input declares it (likely a
typo or a missing variable).

## Variables (inputs)

`inputs[]` declares the variables the owner fills in. Each value
substitutes `{{key}}` tokens across the persona files, knowledge docs,
schedules, and goal — so one bundle adapts to each owner without editing
the files. Tokens that sentrel always provides (`user_name`,
`company_name`, `agent_name`, `company_domain`) need no declaration.

```yaml
inputs:
  - key: timezone           # {{timezone}} in any text
    label: Time zone
    type: text              # text | list | number | boolean | enum
    default: America/Los_Angeles
    required: true
    ask_at: deploy          # deploy (wizard) | onboarding (post-deploy flow)
    validate:               # enforced by the same validator that checks the bundle
      pattern: "^[A-Za-z]+/[A-Za-z_]+$"
  - key: tone
    label: Tone
    type: enum
    options: [formal, casual]
    default: casual
  - key: focus_areas
    label: Focus areas
    type: list              # renders into {{focus_areas}} as a bullet list
    validate: { min_items: 1 }
```

`type` defaults to `text` and `ask_at` to `deploy`. Validation keys by
type: text → `pattern` / `min_length` / `max_length`; number → `min` /
`max`; list → `min_items` / `max_items`; enum constrains to `options`.

## Deploy a bundle

```sh
npx @manifestagent/agentmanifest deploy [bundle-dir] [--server <url>] [--no-open]
```

Validates the bundle (default: the current folder), packs it as a
`.tar.gz`, uploads it to [sentrel](https://www.sentrel.ai), and opens
the deploy wizard in your browser. The wizard previews everything the
bundle installs — persona, skills, schedules, integrations, deploy-time
inputs — and the deploy itself happens there with your signed-in
session, so the CLI never asks for credentials. Invalid bundles are
rejected before anything is uploaded.

Uploads expire after 30 minutes; just run the command again.
`--server` (or `AGENTMANIFEST_SERVER`) targets a self-hosted or local
instance; `--no-open` prints the wizard URL instead of opening a
browser (SSH sessions, CI).

## Examples

- [`examples/sdr`](examples/sdr) — outbound SDR with Apollo, Instantly, and MCP servers
- [`examples/scheduler`](examples/scheduler) — executive scheduler with cron schedules and an `any_of` calendar group
