---
name: fix-workflow
description: Use when shipping a code fix as a GitHub pull request, applying review rework to an existing PR, or wiring a shipped PR back to its Sentry issue and Linear ticket. Step-by-step branch → commit-via-API → PR flow against the connected-apps proxy.
---

# Fix workflow — branch, commit via API, PR, link back

You change code through the GitHub API, not a local checkout. That
means every edit is a file-level operation: read the file, produce the
corrected full content, write it back on a branch. This works well for
surgical fixes (which is all you're allowed to ship) and fails badly
for sweeping changes (which the triage policy already forbids).

## How you call the apps

Every action on GitHub, Linear, and Sentry goes through ONE tool — the
connected-apps proxy:

```
mcp__apps__request({ provider, method, path, query?, body? })
```

- `provider` is the app slug: `github`, `linear`, `sentry`.
- `path` is relative to that app's API base; Rails injects the auth
  token for you. NEVER ask for, include, or echo a token.
- The result is `{ status, body }` — branch on `status`, read `body`.
- Don't use `git` or the `gh` CLI — they aren't authenticated here.
  Every code action goes through `request(...)`.

API bases per provider:

| Provider | Base | Notes |
|----------|------|-------|
| `github` | `https://api.github.com` | REST. Paths start with `/`. See the GitHub skill for the full surface. |
| `linear` | `https://api.linear.app` | GraphQL only — POST `/graphql` with `{ query, variables }`. |
| `sentry` | `https://sentry.io` | REST. Paths start with `/api/0/...`. |

## GitHub calls you need (mirror the GitHub skill)

| Step | Call |
|------|------|
| Repo metadata / default branch | `GET /repos/{owner}/{repo}` → `body.default_branch` |
| Read a file (content + sha) | `GET /repos/{owner}/{repo}/contents/{path}` · `query:{ ref }` → base64 `content` + `sha` |
| Find code by symbol/string | `GET /search/code` · `query:{ q:"<symbol> repo:{owner}/{repo}" }` |
| Get branch head sha | `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` → `body.object.sha` |
| Create branch | `POST /repos/{owner}/{repo}/git/refs` · `body:{ ref:"refs/heads/<name>", sha:<base sha> }` |
| Commit a file change | `PUT /repos/{owner}/{repo}/contents/{path}` · `body:{ message, content:<base64>, branch, sha:<file sha> }` |
| Open the PR | `POST /repos/{owner}/{repo}/pulls` · `body:{ title, head, base, body }` |
| Comment on PR/issue | `POST /repos/{owner}/{repo}/issues/{number}/comments` · `body:{ body }` |

> A new file omits `sha`; updating/deleting a file REQUIRES the current
> blob `sha` (GET the file first). `content` is always base64-encoded.

## Linear calls (GraphQL — POST /graphql)

Linear has no REST endpoints. Send GraphQL documents:

```
mcp__apps__request({ provider:"linear", method:"POST", path:"/graphql",
  body:{ query:"<document>", variables:{ ... } } })
```

| Step | GraphQL |
|------|---------|
| Comment a PR link on a ticket | mutation `commentCreate(input:{ issueId, body })` |
| Move ticket state | mutation `issueUpdate(id:$id, input:{ stateId })` |
| Look up workflow state ids | query `team(id:$teamId){ states { nodes { id name type } } }` |

```
// Comment the PR link + root cause on the ticket
body:{ query:"mutation($id:String!,$body:String!){ commentCreate(input:{issueId:$id, body:$body}){ success } }",
       variables:{ id:"<issueId>", body:"PR: <url>\n\n<root cause>" } }

// Move to In Review (resolve the stateId once from team.states, then remember it)
body:{ query:"mutation($id:String!,$stateId:String!){ issueUpdate(id:$id, input:{stateId:$stateId}){ success } }",
       variables:{ id:"<issueId>", stateId:"<in-review state id>" } }
```

> GraphQL returns `status:200` even for logical errors — check
> `body.errors` before trusting `body.data`. State ids are workspace-
> specific; resolve them once via `team.states.nodes` and reuse.

## Sentry calls (REST — /api/0/...)

| Step | Call |
|------|------|
| Read an issue | `GET /api/0/organizations/{org}/issues/{issue_id}/` |
| Read latest event (stack trace) | `GET /api/0/organizations/{org}/issues/{issue_id}/events/latest/` |
| List events for an issue | `GET /api/0/organizations/{org}/issues/{issue_id}/events/` |
| Mark addressed / resolved | `PUT /api/0/organizations/{org}/issues/{issue_id}/` · `body:{ status:"resolved" }` |

> Sentry paths keep their trailing slash. To flag work in progress
> instead of resolving, use `status:"ignored"` or assign the issue; only
> set `"resolved"` once the fix is actually merged.

Never invent endpoints. If a call errors, re-read this table and the
provider's base — don't guess at a path.

## Shipping a fix

1. **Locate.** From the stack trace or ticket, identify repo + file +
   line. Use `GET /search/code` (provider `github`) when the trace gives
   a symbol but no path. Read the file with
   `GET /repos/{owner}/{repo}/contents/{path}` — note its `sha`; you
   need it to commit. Read enough surrounding code to be sure of the
   invariant you're fixing.
2. **Branch.** `GET /repos/{owner}/{repo}` → `default_branch`. Then
   `GET /repos/{owner}/{repo}/git/ref/heads/{default_branch}` →
   `body.object.sha` (head sha). Then `POST .../git/refs` with
   `ref:"refs/heads/fix/<id>-<slug>"` and that sha.
3. **Commit.** For each file (max 3): produce the FULL corrected file
   content — never a fragment — and call
   `PUT /repos/{owner}/{repo}/contents/{path}` with `branch` (your fix
   branch), `message` (`Fix: <symptom> (<ticket-id>)`), `content`
   (base64-encode the full file), and the file's `sha` from step 1.
   Re-read the file after writing if you commit to it twice.
4. **PR.** `POST /repos/{owner}/{repo}/pulls` with `head` = your branch,
   `base` = the default branch, title and description per the PR
   conventions in the triage policy.
5. **Link back.** On Linear, `commentCreate` on the ticket with the PR
   URL and your one-paragraph root cause, then `issueUpdate` to move it
   to In Review (resolve the state id once via `team.states`, then
   remember it). For Sentry items, `PUT .../issues/{issue_id}/` to mark
   the issue addressed. Update your ledger.

## Rework on an existing PR

Same branch, steps 1 + 3 only — read the file ON THE BRANCH (pass
`query:{ ref:"fix/..." }` to the contents GET; the sha differs from the
default branch now), commit the requested change, then reply on the PR
thread with `POST /repos/{owner}/{repo}/issues/{pr_number}/comments`
(PRs are issues for commenting purposes — use the PR number).

## Invariants

- The diff you ship is the diff you described — no drive-by edits.
- `content` must be the complete file, base64-encoded. A partial file
  REPLACES the whole file and destroys code. When in doubt, re-read.
- A `409` or "sha mismatch" means the file moved under you: re-read the
  file on the branch, re-apply your change to the fresh content, retry
  once. Two failures → stop and report on the ticket.
- A `404` on a repo/file usually means no access, not absence —
  escalate rather than assuming the path changed.
- `401` from any provider means the connection lapsed — tell the user to
  reconnect that app at /integrations; don't retry.
- Two failed attempts at ANY step → stop, write what you tried on the
  ticket, escalate. Never thrash against the API.
