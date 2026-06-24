---
slug: github
name: GitHub
description: Read and write GitHub repos, issues, pull requests, files, commits, releases, and Actions via the GitHub REST API.
category: engineering
icon: github
requires_connections:
  - github
---

# GitHub

Call the GitHub REST API with the **`request`** tool (server `apps`):

```
request({ provider: "github", method, path, query?, body? })
```

- **Base is `https://api.github.com`** — give `path` relative, starting with `/` (e.g. `/user/repos`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/PAT.
- **Do NOT use the `gh` CLI or git.** It's not authenticated here and is blocked. Every GitHub action goes through `request(...)`.
- Default response headers worth reading: `Link` (pagination), `x-ratelimit-remaining` / `x-ratelimit-reset` (rate limits).

## Pagination — READ THIS (it's the #1 mistake)

List endpoints return **one page of 30 by default**. To get everything:

1. Always pass `query: { per_page: 100 }`.
2. If the response is a full page (100 items) or the `Link` header has `rel="next"`, fetch the next page (`query: { per_page: 100, page: 2 }`, then 3, …) until no `next`.
3. **"List all / show all" means ALL pages** — don't stop at page 1, and don't trim the result to your working repo. Your role scopes what you *change*, not what you *report*.

```
// All repos in an org (loop pages until short page / no `next`)
request({ provider:"github", method:"GET", path:"/orgs/ParseDev/repos",
          query:{ type:"all", per_page:100, page:1 } })
```

## Repositories

| Do | Call |
|---|---|
| List MY repos (all I can access) | `GET /user/repos` · `query:{ visibility:"all", affiliation:"owner,collaborator,organization_member", per_page:100 }` |
| List an org's repos | `GET /orgs/{org}/repos` · `query:{ type:"all", per_page:100 }` |
| Get one repo | `GET /repos/{owner}/{repo}` |
| Create a repo (personal) | `POST /user/repos` · `body:{ name, private, description? }` |
| Create a repo (org) | `POST /orgs/{org}/repos` · `body:{ name, private }` |

> `/user/repos`: use **either** `type` **or** (`visibility`+`affiliation`) — not both. To see everything you can touch, use `affiliation=owner,collaborator,organization_member`.
> `/orgs/{org}/repos`: `type` enum is `all|public|private|forks|sources|member` (no `affiliation` here).

## Issues

| Do | Call |
|---|---|
| List issues | `GET /repos/{owner}/{repo}/issues` · `query:{ state:"open\|closed\|all", per_page:100 }` |
| Get an issue | `GET /repos/{owner}/{repo}/issues/{number}` |
| Create an issue | `POST /repos/{owner}/{repo}/issues` · `body:{ title, body?, labels?, assignees? }` |
| Update / close an issue | `PATCH /repos/{owner}/{repo}/issues/{number}` · `body:{ state:"closed", title?, body? }` |
| Comment on an issue/PR | `POST /repos/{owner}/{repo}/issues/{number}/comments` · `body:{ body }` |

> The issues list includes PRs (a PR is an issue). Filter PRs out by checking for a `pull_request` field, or use `/pulls`.

## Pull requests

| Do | Call |
|---|---|
| List PRs | `GET /repos/{owner}/{repo}/pulls` · `query:{ state:"open", per_page:100 }` |
| Get a PR | `GET /repos/{owner}/{repo}/pulls/{number}` |
| Files changed in a PR | `GET /repos/{owner}/{repo}/pulls/{number}/files` · `query:{ per_page:100 }` |
| Create a PR | `POST /repos/{owner}/{repo}/pulls` · `body:{ title, head, base, body? }` |
| Update a PR | `PATCH /repos/{owner}/{repo}/pulls/{number}` · `body:{ title?, body?, state? }` |
| Review a PR | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` · `body:{ event:"APPROVE\|REQUEST_CHANGES\|COMMENT", body? }` |
| Merge a PR | `PUT /repos/{owner}/{repo}/pulls/{number}/merge` · `body:{ merge_method:"merge\|squash\|rebase" }` |

## Files & contents

| Do | Call |
|---|---|
| Read a file | `GET /repos/{owner}/{repo}/contents/{path}` — returns base64 `content` + `sha`. For raw text, you can base64-decode `content`. |
| Create a file | `PUT /repos/{owner}/{repo}/contents/{path}` · `body:{ message, content:<base64> }` |
| Update a file | `PUT /repos/{owner}/{repo}/contents/{path}` · `body:{ message, content:<base64>, sha:<current blob sha> }` |
| Delete a file | `DELETE /repos/{owner}/{repo}/contents/{path}` · `body:{ message, sha }` |

> **Updating/deleting a file REQUIRES the current `sha`** — GET the file first to read its `sha`, then send it back. `content` must be **base64-encoded**.

## Commits & branches

| Do | Call |
|---|---|
| List commits | `GET /repos/{owner}/{repo}/commits` · `query:{ sha?, path?, since?, until?, per_page:100 }` |
| Get a commit (with diff stats) | `GET /repos/{owner}/{repo}/commits/{ref}` |
| List branches | `GET /repos/{owner}/{repo}/branches` · `query:{ per_page:100 }` |
| Get a branch | `GET /repos/{owner}/{repo}/branches/{branch}` |
| Create a branch | `POST /repos/{owner}/{repo}/git/refs` · `body:{ ref:"refs/heads/<name>", sha:<base commit sha> }` |

## Releases

| Do | Call |
|---|---|
| List releases | `GET /repos/{owner}/{repo}/releases` · `query:{ per_page:100 }` |
| Latest release | `GET /repos/{owner}/{repo}/releases/latest` |
| Create a release | `POST /repos/{owner}/{repo}/releases` · `body:{ tag_name, name?, body?, draft?, prerelease? }` |

## GitHub Actions

| Do | Call |
|---|---|
| List workflows | `GET /repos/{owner}/{repo}/actions/workflows` |
| List runs | `GET /repos/{owner}/{repo}/actions/runs` · `query:{ per_page:100 }` |
| Trigger a workflow | `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches` · `body:{ ref:"main", inputs?:{} }` (workflow_id is the file name like `ci.yml` or the numeric id) |
| Re-run a run | `POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun` |

## Search (separate, stricter rate limit: ~30/min)

| Do | Call |
|---|---|
| Search repos | `GET /search/repositories` · `query:{ q:"org:ParseDev language:ruby", per_page:100 }` |
| Search issues/PRs | `GET /search/issues` · `query:{ q:"repo:owner/repo is:pr is:open" }` |
| Search code | `GET /search/code` · `query:{ q:"addEventListener repo:owner/repo" }` |

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token | Connection issue — tell the user to reconnect GitHub at /integrations. Don't retry. |
| 403 + `x-ratelimit-remaining: 0` | Rate limited | Stop. Wait until `x-ratelimit-reset` (epoch seconds), then continue. Search has its own 30/min budget. |
| 404 | Missing OR no access | The repo/resource doesn't exist, or this account can't see it. Don't assume it's a bug — the token only sees what the connected account can access. |
| 409 | Conflict (e.g. empty repo, merge conflict) | Read the message; often a missing base branch or a stale `sha`. |
| 422 | Validation failed | Read `errors[]` — usually a missing required field or a bad value. Fix and retry. |

## Don't
- Don't use `gh` CLI / `git` — use `request(...)`.
- Don't stop at page 1 for "list all".
- Don't update/delete a file without its current `sha`.
- Don't ask the user for a token — auth is already connected.
- Don't trim a requested list down to your working repo unless the user asked for that.
