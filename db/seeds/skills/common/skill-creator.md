---
slug: skill-creator
name: Skill Creator
description: Author new skills (multi-file SKILL.md bundles) for yourself or the workspace
category: common
icon: wrench
requires_connections: []
---

# Skill Creator

This skill teaches you how to author **new skills** for yourself or
the workspace using the `skills.create` and `skills.install_on_me`
tools. A skill is a small bundle of files — at minimum a `SKILL.md`,
optionally helpers — that teaches future-you (or any agent installing
it) how to do a specific task.

## When to use this

- The user asks you to "learn this API", "remember how to do X",
  "build a skill for our internal tool", "codify this workflow".
- You're about to do a job you'll be doing repeatedly (publish blog
  posts, sync a CRM, follow a deployment checklist) — write a skill
  instead of relying on prompt memory.
- Another agent in the workspace would benefit from knowing how to
  do this task — publish the skill to your org (or marketplace) so
  teammates can install it.

## When NOT to use this

- For a one-off task — just do the task. Skills are for repeatable
  patterns.
- For internal documents / context — that's the knowledge base.
- For credentials — that's the credentials store at /settings/credentials.

## The shape of a good skill

Every SKILL.md follows this structure (steal it). Sections are
plain markdown headings; the agent reads them in order.

```
# <Skill Name>

One-sentence what-this-does.

## When to use
- Concrete triggers (user phrases, task patterns)

## When NOT to use
- Off-topic cases that look similar but aren't

## Auth (if external API)
secrets.get({ provider: "..." })
What header / token shape to use. Do not print the key.

## Endpoints / Tools (if external)
Table of operations: name, method, path, body shape.

## Workflow
Numbered steps. Default to draft-first / confirm-before-destructive.

## Examples
At least one happy path. Use curl or pseudocode the agent can copy.

## Error responses
What each non-2xx means and how to recover.

## Rules
- Never log secrets
- Confirm destructive ops
- Stop and ask when the user's intent is ambiguous
```

## How to author a skill

1. **Plan the SKILL.md first.** Sketch the sections above in your
   head before writing. If you can't fill them, you don't understand
   the task well enough yet — ask the user, or use WebSearch.

2. **Pick a slug.** Lowercase letters / digits / hyphens. Derived
   from the name (`"Stripe Subscriptions" → "stripe-subscriptions"`).

3. **Pick a category.** One of: common, sales, support, marketing,
   engineering, content, finance, productivity, generic.

4. **Decide on helper files.** Optional but powerful. Common patterns:
   - `examples/<name>.json` — a paste-ready payload the agent can
     read with its Read tool when filling in a request.
   - `schemas/<name>.json` — JSON Schema or an OpenAPI snippet.
   - `helpers/<name>.py` — a tiny script the agent can Bash-exec.

5. **Call `skills.create`** with `name`, `slug`, `description`,
   `category`, `icon`, and `files: [{ path: "SKILL.md", content: ... }, ...]`.

6. **Install it on yourself** with `skills.install_on_me({ slug })`
   so the files land in your workspace next turn. From that point
   on you Read them like any other skill.

## Examples

### Sketch a new skill in your head before writing

User: "Build a skill so you can post messages to our team Slack."

Plan:
- Auth: org has a `slack` credential? (`secrets.get({ provider: "slack" })`)
  Yes → use Bearer token. No → propose connect via `/integrations`.
- Endpoint: POST https://slack.com/api/chat.postMessage
- Body: `{ channel, text, thread_ts? }`
- When to use: "post to slack", "send a slack message"
- When NOT: DMs to individuals (use users.list + im.open separately)
- Rules: never post in #general without explicit user ok

Then call `skills.create({ name: "Slack Messages", slug: "slack-messages",
category: "common", files: [{ path: "SKILL.md", content: "..." }] })`,
then `skills.install_on_me({ slug: "slack-messages" })`.

### Add a helper file

```
files: [
  { path: "SKILL.md", content: "..." },
  { path: "examples/payload.json", content: '{ "channel": "#general", "text": "hello" }' }
]
```

In the SKILL.md, reference it: "Use examples/payload.json as a template."

## Rules

- **One concept per skill.** Don't bundle "Slack messaging" with
  "Slack analytics". Two skills, two SKILL.mds.
- **Be explicit about auth.** State which credential the skill needs.
  If `secrets.get` returns `no access`, surface a clear next step
  ("ask the user to grant the slack credential at /agents/:id/edit").
- **Never print credentials inside SKILL.md content.** Reference them
  via `secrets.get`, never inline.
- **Idempotent upserts > naive POST.** When writing CRUD skills,
  document the PATCH-then-POST-on-404 dance instead of POSTing blindly.
- **Confirm before destructive ops.** Hardcode the confirmation
  prompt language ("Delete `<title>` permanently? This can't be undone.").
- **Round-trip the slug rule.** If the upstream API has a slug
  format, document the regex in SKILL.md and have the agent
  validate before sending.
- **Draft first.** Skills are private + unpublished by default.
  Test on yourself, then publish via /skills/:slug if it should
  be available to others.
