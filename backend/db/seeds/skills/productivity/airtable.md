---
slug: airtable
name: Airtable
description: Read and write Airtable bases, tables, and records — list, filter, create, update, and delete rows via the Airtable Web API.
category: productivity
icon: airtable
requires_connections:
  - airtable
---

# Airtable

Call the Airtable Web API with the **`request`** tool (server `apps`):

```
request({ provider: "airtable", method, path, query?, body? })
```

- **Base is `https://api.airtable.com/v0`** — give `path` relative, starting with `/` (e.g. `/{baseId}/{tableIdOrName}`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/API key/OAuth credential.
- **Don't use the Airtable SDK or `curl`.** Every action goes through `request(...)`.
- The tool result is `{ status, body }`. Read `body` for the JSON payload.

## The base / table / field model — READ THIS FIRST

Airtable is a hierarchy: a **workspace** holds **bases**, a base holds **tables**, a table holds **records** (rows). Each record is `{ id, createdTime, fields:{...} }` where `fields` is keyed by **field name** (the column header) — `{ "Name": "Acme", "Status": "Active", "Owner": ["recXXXX"] }`.

- **`baseId`** looks like `appXXXXXXXXXXXXXX` — discover it with `GET /meta/bases` (you can't guess it).
- **`tableIdOrName`** — you may use the table **name** (`Tasks`) or its **id** (`tblXXXXXXXXXXXXXX`). Prefer the id; names change and need URL-encoding if they contain spaces.
- **Field values are typed by the column** — a single-select wants a string, a linked-record field wants an array of record ids (`["recXXXX"]`), a checkbox wants `true`/`false`, a date wants ISO-8601. Send the wrong shape and you get a **422**. Discover the schema (field names + types) with the tables endpoint below before writing.

## Discovering bases & schema (do this before anything else)

| Do | Call |
|---|---|
| List bases I can access | `GET /meta/bases` — returns `{ bases:[{ id, name, permissionLevel }], offset? }` |
| List tables + full schema of a base | `GET /meta/bases/{baseId}/tables` — returns `tables[]` with `id`, `name`, `primaryFieldId`, `fields[]` (`{ id, name, type, options }`), and `views[]` |

> `GET /meta/bases` is at `https://api.airtable.com/v0/meta/bases` — same base URL, just a `/meta/...` path. Use it to map a base name → `baseId`, then the tables endpoint to map a table name → `tableId` and learn each field's name/type. **Don't guess field names** — read them from the schema.

## Listing records

```
request({ provider:"airtable", method:"GET", path:"/{baseId}/{tableIdOrName}",
          query:{ pageSize:100, view:"Grid view" } })
// → body: { records:[{ id, createdTime, fields:{...} }, ...], offset? }
```

Useful query params:

| Param | Effect |
|---|---|
| `filterByFormula` | Server-side filter (see below) |
| `sort` | Order results — `sort[0][field]=Created&sort[0][direction]=desc` |
| `maxRecords` | Hard cap on total records returned across all pages |
| `pageSize` | Records per page, **max 100** (default 100) |
| `view` | Return only records in that view, in the view's order/filter |
| `fields` | Return only named fields — `fields[]=Name&fields[]=Status` |
| `offset` | Pagination token (see below) |

### filterByFormula syntax

`filterByFormula` is an Airtable **formula** that must evaluate truthy per record. Reference fields by name in `{curly braces}`, compare with `=`, combine with `AND()`/`OR()`/`NOT()`:

| Want | Formula |
|---|---|
| Status is Active | `{Status}='Active'` |
| Open and high priority | `AND({Status}='Open', {Priority}='High')` |
| Name contains "acme" | `SEARCH('acme', LOWER({Name}))` |
| A field is not empty | `NOT({Email}='')` |
| Created in last 7 days | `IS_AFTER({Created}, DATEADD(NOW(), -7, 'days'))` |

> Pass the formula as the raw `query.filterByFormula` value — Rails URL-encodes it. Quote string literals with single quotes. A malformed formula returns **422**; an empty result set is just `records:[]` (not an error).

## Pagination — READ THIS (offset tokens, not page numbers)

List responses return **at most 100 records** plus an **`offset`** token when more exist.

1. Pass `query:{ pageSize:100 }`.
2. If `body.offset` is present, fetch the next page with `query:{ pageSize:100, offset:<token>, ...same filter/sort... }`.
3. Repeat until the response has **no `offset`**. (`/meta/bases` paginates the same way.)
4. **"List all / show all" means ALL pages** — don't stop at page 1. Your role scopes what you *change*, not what you *report*.

```
// Next page
request({ provider:"airtable", method:"GET", path:"/app123/Tasks",
          query:{ pageSize:100, offset:"itrXXXX/recXXXX" } })
```

> `maxRecords` caps the total — handy to grab "the first N" without looping. Keep `filterByFormula`/`sort`/`view` identical on every page or the offset is meaningless.

## Getting one record

| Do | Call |
|---|---|
| Get a single record | `GET /{baseId}/{tableIdOrName}/{recordId}` — returns `{ id, createdTime, fields:{...} }` |

`recordId` looks like `recXXXXXXXXXXXXXX`. By default fields that are empty are omitted from `fields`.

## Creating records

```
request({ provider:"airtable", method:"POST", path:"/{baseId}/{tableIdOrName}",
          body:{ records:[ { fields:{ Name:"Acme", Status:"Active" } } ], typecast:true } })
// → body: { records:[{ id, createdTime, fields }] }
```

- **Always wrap in `records:[{ fields:{...} }]`** — even for a single row. **Max 10 records per call.** To create more, chunk into batches of 10.
- **`typecast:true`** lets Airtable coerce loose values — it'll convert `"5"`→number, match a single-select option by string, or create a new select option if the field allows it. Without it, values must already match the field type exactly.
- Single-create shortcut: `body:{ fields:{...} }` (no `records` array) also works, but the `records:[...]` form is the one to standardize on.

## Updating records

`PATCH` does a **partial** update (only the fields you send change). `PUT` does a **full** update (fields you omit are **cleared**). Prefer `PATCH` unless you intend to blank out everything else.

| Do | Call |
|---|---|
| Update one record (partial) | `PATCH /{baseId}/{tableIdOrName}/{recordId}` · `body:{ fields:{ Status:"Done" } }` |
| Update up to 10 (partial) | `PATCH /{baseId}/{tableIdOrName}` · `body:{ records:[{ id:"recXXXX", fields:{...} }], typecast:true }` |
| Replace one record (full) | `PUT /{baseId}/{tableIdOrName}/{recordId}` · `body:{ fields:{...} }` |
| Replace up to 10 (full) | `PUT /{baseId}/{tableIdOrName}` · `body:{ records:[{ id, fields }] }` |

> Batch update/replace needs each record's **`id`** alongside its `fields`. **Max 10 records per call** — chunk larger sets. `typecast:true` applies here too.

## Deleting records

| Do | Call |
|---|---|
| Delete one record | `DELETE /{baseId}/{tableIdOrName}/{recordId}` |
| Delete up to 10 | `DELETE /{baseId}/{tableIdOrName}` · `query:{ records[]:"recA", records[]:"recB" }` |

> Batch delete passes record ids as repeated `records[]` query params (not a body). **Max 10 per call.** Deletes are permanent — confirm with the user before deleting records they didn't explicitly name.

## Rate limit — 5 requests / second / base

Airtable allows **5 requests per second per base**. Exceed it and you get **429** plus a 30-second cooldown for that base. When looping pages or chunking batches of 10, **pace your calls** — don't fire all batches at once. On a 429, back off and retry.

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token | Connection issue — tell the user to reconnect Airtable at /integrations. Don't retry. |
| 403 | Not authorized to this base | The connected account can't access this `baseId` (or lacks the scope/permission level for this action). Confirm the base via `GET /meta/bases`; don't assume a bug. |
| 404 | Base / table / record not found | The `baseId`, `tableIdOrName`, or `recordId` is wrong or was deleted. Re-list via `/meta/bases` and the tables endpoint to get current ids. |
| 422 | Invalid request | Usually a bad field name, wrong value type for a field, or a malformed `filterByFormula`. Read `body.error` — check the field against the schema, and consider `typecast:true`. Fix and retry. |
| 429 | Rate limited (>5 req/s) | Stop. Wait out the ~30s cooldown for that base, then resume. Pace future calls. |

## Don't

- Don't guess `baseId`, `tableId`, or field names — read them from `/meta/bases` and the tables/schema endpoint.
- Don't send more than **10 records** in a create/update/delete — chunk into batches of 10.
- Don't use `PUT` when you mean a partial edit — it clears omitted fields; use `PATCH`.
- Don't fire batches/pages faster than ~5/sec per base — you'll 429.
- Don't stop at page 1 for "list all" — follow the `offset` token until it's gone.
- Don't ask the user for an API key — auth is already connected.
