---
slug: google-drive
name: Google Drive
description: List, search, read, download, export, organize, and share Google Drive files and folders via the Drive REST API v3.
category: productivity
icon: google_drive
requires_connections:
  - google-drive
---

# Google Drive

Call the Google Drive REST API v3 with the **`request`** tool (server `apps`):

```
request({ provider: "google-drive", method, path, query?, body? })
```

- **Base is `https://www.googleapis.com/drive/v3`** — give `path` relative, starting with `/` (e.g. `/files`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/OAuth credential.
- **Don't use any Drive SDK, `gcloud`, or `rclone`.** Every action goes through `request(...)`.
- The tool result is `{ status, body }`. Read `body` for the JSON payload (for downloads/exports, `body` is the raw file bytes/text, not JSON).
- A "file" in Drive is **any item, including folders** — a folder is just a file with `mimeType: "application/vnd.google-apps.folder"`. There is no separate folders endpoint.

## The `q` search grammar — READ THIS (it's the #1 mistake)

`GET /files` returns *everything you can see* unless you narrow it with a `q` filter. `q` is a string of clauses combined with `and` / `or`. **String literals use single quotes**, and an unescaped apostrophe inside a name will break the query (escape it as `\'`).

| Want | `q` clause |
|---|---|
| Name match (substring) | `name contains 'budget'` |
| Exact name | `name = 'Q3 Report'` |
| Only folders | `mimeType = 'application/vnd.google-apps.folder'` |
| Exclude folders | `mimeType != 'application/vnd.google-apps.folder'` |
| By type (e.g. PDFs) | `mimeType = 'application/pdf'` |
| Google Docs / Sheets | `mimeType = 'application/vnd.google-apps.document'` · `'...spreadsheet'` |
| Children of a folder | `'{folderId}' in parents` (use the literal folder id in quotes) |
| Not trashed | `trashed = false` |
| Modified since | `modifiedTime > '2026-01-01T00:00:00'` (RFC 3339) |
| Full-text content | `fullText contains 'invoice'` |
| Shared with me | `sharedWithMe = true` |
| Starred | `starred = true` |

Combine with `and`:

```
// Non-trashed PDFs inside a folder, newest first
request({ provider:"google-drive", method:"GET", path:"/files",
          query:{ q:"'1A2b3C4dFolderId' in parents and mimeType='application/pdf' and trashed=false",
                  orderBy:"modifiedTime desc",
                  fields:"nextPageToken, files(id,name,mimeType,modifiedTime,size)",
                  pageSize:100 } })
```

> **Always pass `trashed = false`** unless you specifically want trashed items — Drive includes trashed files by default in many queries.

### `fields` — ask for what you need

By default `/files` returns only `id`, `name`, and `mimeType` per file (and the list is wrapped). Use `fields` to widen or narrow it. **For a list you must name the wrapper `files(...)` and include `nextPageToken`** or you'll lose pagination:

```
fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size,parents,owners,webViewLink)"
```

For a single-file `GET`, pass the fields bare: `fields: "id,name,mimeType,parents,modifiedTime,size"`. Use `fields: "*"` to get everything (heavier).

## Pagination — READ THIS

`GET /files` returns **one page** (default ~100, set with `pageSize`, max 1000) plus a `nextPageToken`.

1. Pass `query: { pageSize: 100 }` (and `fields` that include `nextPageToken`).
2. If the response has a `nextPageToken`, fetch the next page with `query: { ..., pageToken: <token> }` until there's no `nextPageToken`.
3. **"List all / show all" means ALL pages** — don't stop at page 1. Your role scopes what you *change*, not what you *report*.

```
request({ provider:"google-drive", method:"GET", path:"/files",
          query:{ q:"name contains 'report' and trashed=false",
                  fields:"nextPageToken, files(id,name,mimeType,modifiedTime)",
                  pageSize:100, pageToken:"<nextPageToken>" } })
```

## Listing & searching files

| Do | Call |
|---|---|
| Search files | `GET /files` · `query:{ q:"<query>", fields, pageSize:100 }` |
| List a folder's contents | `GET /files` · `query:{ q:"'{folderId}' in parents and trashed=false", fields, pageSize:100 }` |
| Find a folder by name | `GET /files` · `query:{ q:"mimeType='application/vnd.google-apps.folder' and name='Invoices'" }` |
| Get one file's metadata | `GET /files/{fileId}` · `query:{ fields:"id,name,mimeType,parents,size,modifiedTime,webViewLink" }` |

## Downloading vs. exporting — the key distinction

**Binary/uploaded files** (PDFs, images, .docx, .xlsx, .csv — anything with a real `mimeType` and a `size`) have actual bytes you download directly:

```
// Download raw file content
request({ provider:"google-drive", method:"GET", path:"/files/{fileId}",
          query:{ alt:"media" } })
// → body is the raw file content (bytes/text)
```

**Google-native files** (Docs, Sheets, Slides — `mimeType` starting `application/vnd.google-apps.*`) have **no downloadable bytes**. `alt=media` on them returns **403 "Use Export with Google Docs files"**. You must `export` to a concrete format:

```
// Export a Google Doc to plain text (or PDF, .docx, etc.)
request({ provider:"google-drive", method:"GET", path:"/files/{fileId}/export",
          query:{ mimeType:"text/plain" } })
```

| Google-native type | Useful export `mimeType` |
|---|---|
| Doc | `text/plain` · `application/pdf` · `text/html` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx) |
| Sheet | `text/csv` · `application/pdf` · `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx) |
| Slides | `application/pdf` · `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx) |

> Decide by `mimeType` first: if it starts with `application/vnd.google-apps.` → **export**; otherwise → `alt=media` **download**. For reading a Doc's text, `export` with `mimeType: "text/plain"` is the simplest.

## Creating folders

A folder is a file with the folder mime type. No content body — just metadata:

```
request({ provider:"google-drive", method:"POST", path:"/files",
          body:{ name:"Q3 Reports",
                 mimeType:"application/vnd.google-apps.folder",
                 parents:["<parentFolderId>"] } })   // omit parents → goes to My Drive root
```

> Creating files **with content** uses the separate upload endpoint (`/upload/drive/v3/files` with `uploadType`), which is multipart and out of scope here. This skill covers metadata-only creates (folders) and shortcuts; for content, prefer creating in the native app or exporting from an existing file.

## Copy & move

| Do | Call |
|---|---|
| Copy a file | `POST /files/{fileId}/copy` · `body:{ name?:"Copy of X", parents?:["<folderId>"] }` |
| Move a file | `PATCH /files/{fileId}` · `query:{ addParents:"<newFolderId>", removeParents:"<oldFolderId>" }` |
| Rename a file | `PATCH /files/{fileId}` · `body:{ name:"New name" }` |

> **Move is a `PATCH` with `addParents`/`removeParents` as query params**, not a body field — Drive's parent model means you add the new parent and remove the old one in one call. To find the current parent to remove, GET the file with `fields: "parents"`.

```
// Move file from one folder to another
request({ provider:"google-drive", method:"PATCH", path:"/files/{fileId}",
          query:{ addParents:"<destFolderId>", removeParents:"<currentFolderId>",
                  fields:"id,parents" } })
```

## Sharing (permissions)

Grant access by creating a permission on the file (or folder — folder permissions cascade to children):

```
request({ provider:"google-drive", method:"POST", path:"/files/{fileId}/permissions",
          body:{ role:"reader", type:"user", emailAddress:"alice@acme.com" },
          query:{ sendNotificationEmail:true } })
```

- `role`: `reader` · `commenter` · `writer` · `owner` (transfer) · `organizer` (shared drives).
- `type`: `user` · `group` (both need `emailAddress`) · `domain` (needs `domain`) · `anyone` (link sharing — anyone with the link).
- "Share with anyone who has the link": `body:{ role:"reader", type:"anyone" }`.
- List/revoke: `GET /files/{fileId}/permissions` · `DELETE /files/{fileId}/permissions/{permissionId}`.

> Sharing externally exposes content. For shares **outside the workspace**, confirm the recipient and role with the user first — gate it behind `request_approval` rather than sharing silently.

## Shared drives (Team Drives)

Files in shared drives are invisible to the default queries. To include them, pass on **every** relevant call:

- `supportsAllDrives: true` — required on `get`, `create`, `copy`, `update`/move, and `permissions` for shared-drive items.
- `includeItemsFromAllDrives: true` **and** `supportsAllDrives: true` — on `/files` list/search to see shared-drive results.

```
request({ provider:"google-drive", method:"GET", path:"/files",
          query:{ q:"name contains 'budget' and trashed=false",
                  includeItemsFromAllDrives:true, supportsAllDrives:true,
                  fields:"nextPageToken, files(id,name,mimeType,driveId)", pageSize:100 } })
```

> If a file you know exists doesn't show up, it's almost always a shared-drive item — re-run with both flags before assuming it's missing.

## Trashing & deleting

| Do | Call |
|---|---|
| Move to trash | `PATCH /files/{fileId}` · `body:{ trashed:true }` |
| Restore from trash | `PATCH /files/{fileId}` · `body:{ trashed:false }` |
| Delete permanently | `DELETE /files/{fileId}` (irreversible — skips trash) |

> Prefer `trashed:true` over `DELETE`. Permanent delete cannot be undone — only use it when the user explicitly asks to delete forever.

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token | Connection issue — tell the user to reconnect Google Drive at /integrations. Don't retry. |
| 403 | Insufficient scope, no permission, or quota | Read `body.error.message`: if it mentions scope/`insufficientPermissions`, the connection lacks the needed access (e.g. read-only token trying to write/share) — user must reconnect with broader access. "Use Export with Google Docs files" means you called `alt=media` on a Google-native file — switch to `/export`. If `rateLimitExceeded`/`userRateLimitExceeded`, back off and retry. |
| 404 | File/folder not found | The id is wrong, was deleted, or lives in a shared drive — re-list (with `supportsAllDrives`+`includeItemsFromAllDrives`) to get current ids. The token only sees what the connected account can access. |
| 400 | Bad request | Usually a malformed `q` (check single quotes / escaped apostrophes), a bad `fields` mask, or an invalid export `mimeType`. Read `body.error.message`, fix, retry. |
| 429 | Too many requests | Stop and back off, then retry the failed call. |

## Don't

- Don't call `alt=media` on Google Docs/Sheets/Slides — they have no bytes; use `/export` with a target `mimeType`.
- Don't forget `trashed = false` in `q` — trashed files leak into results otherwise.
- Don't drop `nextPageToken` from your `fields` mask, then wonder why "list all" stops at one page.
- Don't search shared drives without `supportsAllDrives` **and** `includeItemsFromAllDrives` — results will be incomplete.
- Don't move a file by only adding a parent — also `removeParents` the old one, or it ends up in both folders.
- Don't permanently `DELETE` when the user said "remove" — trash it (`trashed:true`) so it's recoverable.
- Don't ask the user for a token — auth is already connected.
