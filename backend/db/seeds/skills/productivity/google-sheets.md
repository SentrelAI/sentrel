---
slug: google-sheets
name: Google Sheets
description: Read, write, append, and format Google Sheets — cell values, ranges, batch reads/updates, and structural edits — via the Sheets REST API.
category: productivity
icon: google_sheets
requires_connections:
  - google-sheet
---

# Google Sheets

Call the Google Sheets REST API with the **`request`** tool (server `apps`):

```
request({ provider: "google-sheet", method, path, query?, body? })
```

- **Base is `https://sheets.googleapis.com/v4`** — give `path` relative, starting with `/` (e.g. `/spreadsheets/{id}/values/Sheet1!A1:D100`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/OAuth credential.
- **Don't use any Sheets SDK, `gcloud`, or the Drive API.** Every action goes through `request(...)`.
- The tool result is `{ status, body }`. Read `body` for the JSON payload.
- The **spreadsheet id** is the long string in the URL: `docs.google.com/spreadsheets/d/<THIS>/edit`. It is NOT the file name.

## A1 notation — READ THIS (the #1 mistake)

Almost every values call takes a **`range` in A1 notation**, and it must be **sheet-name-qualified**:

| Range | Means |
|---|---|
| `Sheet1!A1:D100` | Cells A1 through D100 on the tab named `Sheet1` |
| `Sheet1!A:A` | The entire column A |
| `Sheet1!2:2` | The entire row 2 |
| `Sheet1` | All cells on the tab `Sheet1` |
| `'Q3 Budget'!A1:B10` | Tab name with a space — **wrap the name in single quotes** |

- The part before `!` is the **tab/sheet name**, not the spreadsheet title. A spreadsheet (file) has many sheets (tabs). Default first tab is usually `Sheet1`.
- If you don't know the tab names, `GET /spreadsheets/{id}` first and read `sheets[].properties.title`.
- The range goes **in the path** — URL-encode it (the tool handles encoding of `path`, but be aware `!`, spaces, and `'` are part of the range string).
- A bad/unknown range → **400** `Unable to parse range`. A range pointing at a missing tab → 400 too.

## USER_ENTERED vs RAW — READ THIS (writes)

Every write (`update`, `append`, `batchUpdate` values) needs **`valueInputOption`**:

- **`USER_ENTERED`** — values are parsed exactly as if a person typed them: `=SUM(A1:A5)` becomes a formula, `1/2/2026` becomes a date, `5%` becomes a percentage, `$1,200` a currency number. **Use this by default.**
- **`RAW`** — values are stored verbatim as strings/numbers, no parsing: `=SUM(...)` stays the literal text `=SUM(...)`. Use only when you explicitly want no formula/format interpretation.

> Omitting `valueInputOption` defaults to the invalid `INPUT_VALUE_OPTION_UNSPECIFIED` and **400s**. Always set it.

## Values are a 2D array (`values`)

Cell values are always a **list of rows, each row a list of cells**: `[[ "A1", "B1" ], [ "A2", "B2" ]]`. `majorDimension` controls orientation:

- **`ROWS`** (default) — outer array = rows, inner = columns. `[["Name","Age"],["Ada",36]]` writes two rows.
- **`COLUMNS`** — outer array = columns. Use to read/write a single column as a flat-ish list.

## Reading values

| Do | Call |
|---|---|
| Read a range | `GET /spreadsheets/{id}/values/Sheet1!A1:D100` |
| Read a whole tab | `GET /spreadsheets/{id}/values/Sheet1` |
| Read a column | `GET /spreadsheets/{id}/values/Sheet1!A:A` · `query:{ majorDimension:"COLUMNS" }` |
| Read formulas (not computed values) | `query:{ valueRenderOption:"FORMULA" }` |

```
request({ provider:"google-sheet", method:"GET",
          path:"/spreadsheets/1AbcXyz.../values/Sheet1!A1:D100" })
// → body: { range, majorDimension:"ROWS", values:[ ["Name","Email",...], ... ] }
```

- `valueRenderOption` enum: `FORMATTED_VALUE` (default, what the user sees, e.g. `$1,200`) · `UNFORMATTED_VALUE` (raw number `1200`) · `FORMULA` (the underlying `=...`). Use `UNFORMATTED_VALUE` when you need to do math on the result.
- **Trailing empty cells/rows are omitted** — rows can have different lengths and `values` may be shorter than the range or absent entirely if the range is empty. Don't assume a rectangular grid.

## Batch read (multiple ranges in one call)

| Do | Call |
|---|---|
| Read several ranges | `GET /spreadsheets/{id}/values:batchGet` · `query:{ ranges:["Sheet1!A1:B5","Sheet2!A1:A10"] }` |

Returns `body.valueRanges[]`, one entry per requested range. Prefer this over N separate gets.

## Updating values (overwrite a known range)

`PUT /spreadsheets/{id}/values/{range}` · `query:{ valueInputOption:"USER_ENTERED" }` · `body:{ values:[[...]] }`

```
request({ provider:"google-sheet", method:"PUT",
          path:"/spreadsheets/1AbcXyz.../values/Sheet1!A1:B2",
          query:{ valueInputOption:"USER_ENTERED" },
          body:{ values:[ ["Name","Total"], ["Ada","=B3+B4"] ] } })
// → body: { updatedRange, updatedRows, updatedColumns, updatedCells }
```

- The `range` in the path is the **anchor**: writing a 2x2 `values` to `A1` fills `A1:B2` regardless of the range's stated end. The values shape wins.
- This **overwrites** the target cells. It does not insert rows or shift existing data.
- To **clear** a range instead of writing: `POST /spreadsheets/{id}/values/Sheet1!A1:D100:clear` (no body).

## Appending rows (add to the bottom of a table)

`POST /spreadsheets/{id}/values/{range}:append` · `query:{ valueInputOption:"USER_ENTERED", insertDataOption:"INSERT_ROWS" }` · `body:{ values:[[...]] }`

```
request({ provider:"google-sheet", method:"POST",
          path:"/spreadsheets/1AbcXyz.../values/Sheet1!A1:append",
          query:{ valueInputOption:"USER_ENTERED", insertDataOption:"INSERT_ROWS" },
          body:{ values:[ ["Grace","grace@acme.com","2026-06-26"] ] } })
// → body: { updates:{ updatedRange, updatedRows, updatedCells } }
```

- Append **finds the table** that overlaps the given range and writes after its last row. The `range` is a hint for *which* table — `Sheet1!A1` (or just `Sheet1`) is fine.
- **`insertDataOption:"INSERT_ROWS"`** pushes existing rows down and inserts new ones — safest when there's data below the table. The default `OVERWRITE` writes into existing cells after the table and can clobber unrelated data lower on the sheet. Prefer `INSERT_ROWS`.
- Read `body.updates.updatedRange` to learn where the rows actually landed.

## Batch update values (multiple ranges in one write)

`POST /spreadsheets/{id}/values:batchUpdate` · `body:{ valueInputOption:"USER_ENTERED", data:[ { range, values }, ... ] }`

```
request({ provider:"google-sheet", method:"POST",
          path:"/spreadsheets/1AbcXyz.../values:batchUpdate",
          body:{ valueInputOption:"USER_ENTERED",
                 data:[ { range:"Sheet1!A1:A2", values:[["x"],["y"]] },
                        { range:"Sheet2!B1",   values:[["z"]] } ] } })
```

Here `valueInputOption` goes in the **body**, not the query. Use this to update scattered cells without one call per range.

## Structural edits — `spreadsheets:batchUpdate`

For anything that isn't plain cell values — adding/deleting tabs, formatting, merging, inserting/deleting rows/columns, conditional formatting, freezing, sorting — use the **spreadsheet-level** batchUpdate with a `requests[]` array:

`POST /spreadsheets/{id}:batchUpdate` · `body:{ requests:[ {<requestKind>:{...}}, ... ] }`

| Want | Request |
|---|---|
| Add a tab | `{ addSheet:{ properties:{ title:"Q3" } } }` |
| Delete a tab | `{ deleteSheet:{ sheetId:<sheetId> } }` |
| Rename a tab | `{ updateSheetProperties:{ properties:{ sheetId, title:"New" }, fields:"title" } }` |
| Insert rows | `{ insertDimension:{ range:{ sheetId, dimension:"ROWS", startIndex:0, endIndex:3 } } }` |
| Bold a header row | `{ repeatCell:{ range:{ sheetId, startRowIndex:0, endRowIndex:1 }, cell:{ userEnteredFormat:{ textFormat:{ bold:true } } }, fields:"userEnteredFormat.textFormat.bold" } }` |
| Freeze header row | `{ updateSheetProperties:{ properties:{ sheetId, gridProperties:{ frozenRowCount:1 } }, fields:"gridProperties.frozenRowCount" } }` |

```
request({ provider:"google-sheet", method:"POST",
          path:"/spreadsheets/1AbcXyz.../batchUpdate",
          body:{ requests:[ { addSheet:{ properties:{ title:"June" } } } ] } })
// → body: { replies:[ { addSheet:{ properties:{ sheetId, title, index } } } ] }
```

> **`sheetId` is a number, not the tab name.** It's the integer per tab (`sheets[].properties.sheetId`), distinct from the spreadsheet id. Get it from `GET /spreadsheets/{id}`. Structural requests use **0-based, half-open** indices (`startIndex` inclusive, `endIndex` exclusive). `fields` is a field mask listing exactly which properties you're setting.

## Creating a spreadsheet

`POST /spreadsheets` · `body:{ properties:{ title }, sheets?:[...] }`

```
request({ provider:"google-sheet", method:"POST", path:"/spreadsheets",
          body:{ properties:{ title:"2026 Pipeline" },
                 sheets:[ { properties:{ title:"Deals" } } ] } })
// → body: { spreadsheetId, spreadsheetUrl, sheets:[...] }
```

Save `body.spreadsheetId` for follow-up calls and share `body.spreadsheetUrl` with the user.

## Reading spreadsheet metadata

| Do | Call |
|---|---|
| Get spreadsheet + all tab properties | `GET /spreadsheets/{id}` |
| Get one tab's grid data | `GET /spreadsheets/{id}` · `query:{ ranges:["Sheet1!A1:D10"], includeGridData:true }` |

`GET /spreadsheets/{id}` (without `includeGridData`) is cheap and returns `properties.title` plus `sheets[].properties` (`sheetId`, `title`, `index`, `gridProperties.rowCount/columnCount`). Use it to **resolve tab names → `sheetId`** and to learn dimensions before reading/writing.

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token | Connection issue — tell the user to reconnect Google Sheets at /integrations. Don't retry. |
| 403 | No access OR scope/quota | If `body.error.message` mentions permission, the connected account can't open this spreadsheet — ask the user to **share** the file with that account (or check it's the right account). If it mentions scope, reconnect with edit access. If `rateLimitExceeded`/`userRateLimitExceeded`/`quotaExceeded`, back off and retry. |
| 400 | Bad request | Usually a **bad range** (`Unable to parse range` — fix the A1 / tab name), a missing/invalid `valueInputOption`, or malformed `values`. Read `body.error.message`, fix, retry. |
| 404 | Spreadsheet id not found | The `spreadsheetId` is wrong or the file was deleted. Don't assume a bug — re-confirm the id from the URL. |
| 429 | Too many requests | Per-minute read/write quota hit. Stop, back off, then retry. Batch calls (`batchGet`/`batchUpdate`) reduce request count. |

## Don't
- Don't pass an unqualified range (`A1:D100`) — always qualify the tab (`Sheet1!A1:D100`); quote names with spaces.
- Don't omit `valueInputOption` on writes — it 400s. Default to `USER_ENTERED`.
- Don't confuse the **spreadsheet id** (string in the URL), the **tab/sheet name** (before `!`), and the **`sheetId`** (integer per tab).
- Don't use append's default `OVERWRITE` when there's data below the table — use `INSERT_ROWS`.
- Don't assume `values` is a full rectangle — trailing empty cells/rows are dropped.
- Don't ask the user for a token — auth is already connected.
