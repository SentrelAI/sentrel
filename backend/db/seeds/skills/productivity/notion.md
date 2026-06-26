---
slug: notion
name: Notion
description: Read and write Notion pages, databases, and blocks — search, query databases, create and update pages, and read/append block content via the Notion REST API.
category: productivity
icon: notion
requires_connections:
  - notion
---

# Notion

Call the Notion REST API with the **`request`** tool (server `apps`):

```
request({ provider: "notion", method, path, query?, body? })
```

- **Base is `https://api.notion.com`** — give `path` relative, starting with `/` (e.g. `/v1/search`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/integration secret.
- **The `Notion-Version` header is injected for you too** — don't set it, don't worry about it.
- **Don't use any Notion SDK (`@notionhq/client`) or a personal API key.** Every action goes through `request(...)`.
- The tool result is `{ status, body }`. Read `body` for the JSON payload.

## The page-vs-database model — READ THIS FIRST

Notion has two object types you'll work with, and they are NOT the same thing:

- A **database** is a structured collection — it has a **schema** (named, typed properties like `Status`, `Due`, `Owner`). Think "table". You **query** a database to get its rows.
- A **page** is a single item. A page that lives **inside a database** is a "row" and its `properties` match that database's schema. A page that lives under another page (or the workspace) is a free-form doc whose only real property is its `title`.
- A page's **content** (the paragraphs, headings, to-dos you see in the body) is NOT in `properties` — it's a tree of **blocks**, fetched/edited separately via the blocks endpoints below.

Every object in a list response carries an `object` field (`"page"` | `"database"` | `"block"`) and an `id` (a UUID). Use that to tell them apart.

## Property values are typed objects — READ THIS

A page's `properties` is a map of **property name → typed value object**. The shape depends on the property's type, e.g.:

```
"properties": {
  "Name":   { "title":     [{ "text": { "content": "Launch plan" } }] },
  "Status": { "status":    { "name": "In progress" } },
  "Done":   { "checkbox":  true },
  "Owner":  { "people":    [{ "id": "<user-uuid>" }] },
  "Due":    { "date":      { "start": "2026-07-01" } },
  "Notes":  { "rich_text": [{ "text": { "content": "ship it" } }] },
  "Count":  { "number":    42 }
}
```

- `title` and `rich_text` are **arrays of rich-text objects**, not plain strings — to read the text, concatenate each item's `.plain_text`; to write, wrap your string as `[{ "text": { "content": "..." } }]`.
- When you create/update a page, **the property names and types must match the target database's schema exactly.** If you don't know the schema, `GET /v1/databases/{id}` first and read its `properties` (each entry tells you the property's `type`).

## Pagination — READ THIS (it's the #1 mistake)

List-style endpoints (`search`, database query, block children) return **one page (default/max 100)** plus cursor fields. The response is `{ object:"list", results:[...], has_more, next_cursor }`.

1. Pass `body: { page_size: 100 }` (or `query: { page_size: 100 }` on GET endpoints).
2. If `body.has_more` is `true`, fetch the next page with the **`start_cursor`** set to the returned `next_cursor`, until `has_more` is `false`.
3. **"List all / show all" means ALL pages** — don't stop at page 1. Your role scopes what you *change*, not what you *report*.

```
// First page of a database query
request({ provider:"notion", method:"POST", path:"/v1/databases/<db-id>/query",
          body:{ page_size:100 } })
// → body: { object:"list", results:[...], has_more:true, next_cursor:"<cursor>" }

// Next page
request({ provider:"notion", method:"POST", path:"/v1/databases/<db-id>/query",
          body:{ page_size:100, start_cursor:"<cursor>" } })
```

## Search (find pages & databases by title)

`POST /v1/search` searches across everything the integration has been **shared on**.

| Do | Call |
|---|---|
| Search by title | `POST /v1/search` · `body:{ query:"Roadmap", page_size:100 }` |
| Only pages | `POST /v1/search` · `body:{ query:"...", filter:{ value:"page", property:"object" } }` |
| Only databases | `POST /v1/search` · `body:{ query:"...", filter:{ value:"database", property:"object" } }` |
| Most-recently edited first | `POST /v1/search` · `body:{ sort:{ direction:"descending", timestamp:"last_edited_time" } }` |

> Search matches **page/database titles only**, not body text. An empty/omitted `query` returns everything shared with the integration (paginate it). Results mix pages and databases — branch on each result's `object` field. If a page you expect is missing, it almost certainly **hasn't been shared with the integration** (see 404 below).

## Query a database (get its rows)

`POST /v1/databases/{database_id}/query` — returns the database's pages, with optional `filter` and `sorts`.

| Do | Call |
|---|---|
| All rows | `POST /v1/databases/{id}/query` · `body:{ page_size:100 }` |
| Filter rows | `POST /v1/databases/{id}/query` · `body:{ filter:{ property:"Status", status:{ equals:"Done" } } }` |
| Sort rows | `POST /v1/databases/{id}/query` · `body:{ sorts:[{ property:"Due", direction:"ascending" }] }` |
| Get the schema | `GET /v1/databases/{id}` — read `body.properties` for property names + types |

- A **filter** targets one property and uses a **type-specific condition** keyed by the property's type: `{ property:"Done", checkbox:{ equals:true } }`, `{ property:"Name", title:{ contains:"plan" } }`, `{ property:"Due", date:{ on_or_after:"2026-06-01" } }`.
- **Compound filters:** combine with `and` / `or`: `body:{ filter:{ and:[ {…}, {…} ] } }`.
- **Sorts** is an array; earlier entries win. You can also sort on timestamps: `{ timestamp:"created_time", direction:"descending" }`.
- Filtering wrong (e.g. using `select` condition on a `status` property) returns **400** — match the condition key to the schema type.

## Retrieve a page

| Do | Call |
|---|---|
| Get a page (properties) | `GET /v1/pages/{page_id}` — returns `properties`, `parent`, `url`, `archived` |
| Get one property's value | `GET /v1/pages/{page_id}/properties/{property_id}` (for large/paginated props like relations or rollups) |

> `GET /v1/pages/{id}` returns the page's **properties only — NOT its body content.** To read the paragraphs/headings/to-dos, fetch its block children (below). For database rows, large property values may be truncated and need the per-property endpoint.

## Create a page

`POST /v1/pages` — `parent` decides where it lands, and which `properties` are valid.

| Create | Call |
|---|---|
| A row in a database | `POST /v1/pages` · `body:{ parent:{ database_id:"<db-id>" }, properties:{ ... } }` |
| A page under another page | `POST /v1/pages` · `body:{ parent:{ page_id:"<page-id>" }, properties:{ title:[{ text:{ content:"..." } }] } }` |
| With body content | `POST /v1/pages` · `body:{ parent:{...}, properties:{...}, children:[ <block objects> ] }` |

- **`parent` is required** and is exactly one of `{ database_id }` or `{ page_id }`. A database row's `properties` must match that database's schema; a page-parented page only needs `title`.
- **`children`** is an optional array of block objects for the new page's body, e.g. a paragraph:

```
request({ provider:"notion", method:"POST", path:"/v1/pages",
  body:{
    parent:{ database_id:"<db-id>" },
    properties:{
      "Name":   { title:[{ text:{ content:"Launch plan" } }] },
      "Status": { status:{ name:"In progress" } }
    },
    children:[
      { object:"block", type:"heading_2",
        heading_2:{ rich_text:[{ text:{ content:"Goals" } }] } },
      { object:"block", type:"paragraph",
        paragraph:{ rich_text:[{ text:{ content:"Ship by Q3." } }] } }
    ]
  }})
```

## Update page properties

`PATCH /v1/pages/{page_id}` — send only the properties you want to change.

| Do | Call |
|---|---|
| Change a property | `PATCH /v1/pages/{id}` · `body:{ properties:{ "Status": { status:{ name:"Done" } } } }` |
| Archive (delete) a page | `PATCH /v1/pages/{id}` · `body:{ archived:true }` |
| Un-archive | `PATCH /v1/pages/{id}` · `body:{ archived:false }` |

> This edits **properties, not body content** — it cannot add paragraphs. Use the append-blocks endpoint for content. Property values must match the schema's types; the values you omit are left untouched.

## Read block children (a page's body content)

`GET /v1/blocks/{block_id}/children` — the body of a page is the children of the **page block** (use the page id as `block_id`).

| Do | Call |
|---|---|
| Read a page's body | `GET /v1/blocks/{page_id}/children` · `query:{ page_size:100 }` |
| Read a block's nested children | `GET /v1/blocks/{block_id}/children` · `query:{ page_size:100 }` |

> Blocks are a **tree, paginated per level.** Each returned block has `has_children` — to read nested content (toggles, list items with sub-items), recurse into `GET /v1/blocks/{that block id}/children`. Paginate each level with `start_cursor`/`next_cursor` like everything else. Text lives in each block's `<type>.rich_text[]` — read `.plain_text`.

## Append blocks (add body content)

`PATCH /v1/blocks/{block_id}/children` · `body:{ children:[ <block objects> ] }` — appends to the end of that block's content. Use the **page id** as `block_id` to add to the page body.

```
request({ provider:"notion", method:"PATCH",
  path:"/v1/blocks/<page-id>/children",
  body:{ children:[
    { object:"block", type:"to_do",
      to_do:{ rich_text:[{ text:{ content:"Send recap" } }], checked:false } },
    { object:"block", type:"bulleted_list_item",
      bulleted_list_item:{ rich_text:[{ text:{ content:"Item one" } }] } }
  ]}})
```

- Common block types: `paragraph`, `heading_1`/`heading_2`/`heading_3`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `quote`, `code`, `divider`. Each wraps its content under a key matching its `type`.
- To insert after a specific block (not at the end), pass `after:"<block-id>"` alongside `children`.

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token (`unauthorized`) | Connection issue — tell the user to reconnect Notion at /integrations. Don't retry. |
| 403 | Restricted / capability missing | The integration lacks the needed capability (e.g. insert/update content). User must reconnect with the right access. |
| 404 | Not found **or not shared** | The id is wrong, OR — most commonly — the page/database **hasn't been shared with the integration**. Notion only sees pages it's been added to. Tell the user to open the page → ••• menu → Connections → add the integration. Don't assume it's a bug. |
| 400 | Validation (`validation_error`) | Read `body.message` — usually a property name/type that doesn't match the database schema, a malformed rich-text/block, or a wrong filter condition key. Fix and retry. |
| 409 | Conflict | A concurrent edit conflict — re-fetch the object and retry. |
| 429 | Rate limited | Stop. Read the **`Retry-After`** response header (seconds) and wait that long before retrying. Notion's average limit is ~3 requests/sec. |

## Don't

- Don't set the `Notion-Version` header — it's injected for you.
- Don't treat `title`/`rich_text` as plain strings — they're rich-text **arrays** (`[{ text:{ content } }]`).
- Don't expect page body content from `GET /v1/pages/{id}` — that returns properties only; use the blocks endpoints for content.
- Don't send properties that don't match the target database's schema — `GET /v1/databases/{id}` first if unsure.
- Don't stop at page 1 for "list all" — follow `has_more` / `next_cursor`, and recurse into nested blocks.
- Don't conclude a page is missing on a 404 — it's usually just not shared with the integration.
- Don't ask the user for a token — auth is already connected.
