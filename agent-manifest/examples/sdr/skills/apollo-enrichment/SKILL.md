---
name: apollo-enrichment
description: Build and enrich lead lists with Apollo — people/company search, contact enrichment, verified emails. Use when asked to find leads, build a list, or fill in missing contact/company data.
---

# Apollo enrichment

Build targeted lead lists and enrich them so every lead has a verified
email, correct title, and enough company context to personalize.

Call the Apollo.io REST API with the **`request`** tool (server `apps`):

```
request({ provider: "apollo", method, path, query?, body? })
```

- **Base is `https://api.apollo.io`** — give `path` relative, starting
  with `/` (e.g. `/api/v1/mixed_people/search`).
- **Auth is injected for you.** Apollo's API key is added as the
  `X-Api-Key` header automatically. NEVER ask for, include, or echo a key.
- **Most search/write endpoints are `POST`** with a JSON `body` — pass
  filters in `body`, not query strings.
- **Credits are real money.** Search is cheap; enrichment (revealing
  emails/phones) burns credits. Search first, enrich only chosen leads.
- **One Apollo call at a time — never in parallel.** Apollo rate-limits
  hard; parallel calls all fail with vague errors.

## Find companies that fit the ICP

`POST /api/v1/mixed_companies/search` — filter accounts by industry,
headcount, location. Use the returned org `id`s to target people at
those companies.

```
request({ provider:"apollo", method:"POST", path:"/api/v1/mixed_companies/search",
          body:{ q_organization_keyword_tags:["B2B SaaS"],
                 organization_num_employees_ranges:["20,500"],
                 page:1, per_page:25 } })
```

## Find people (the workhorse)

`POST /api/v1/mixed_people/search` — returns people **and** their
organizations in one call. Filters go in `body` as arrays:

| Filter | Meaning |
|---|---|
| `person_titles` | Job titles, e.g. `["VP of Sales","Head of Revenue"]` |
| `person_seniorities` | `["founder","c_suite","vp","director"]` |
| `person_locations` | Person location, e.g. `["United States"]` |
| `organization_num_employees_ranges` | Headcount as comma strings, e.g. `["20,500"]` |
| `q_organization_keyword_tags` | Industry/company keywords |
| `organization_ids` | Restrict to specific Apollo org ids |
| `contact_email_status` | `["verified"]` to bias toward reachable people |
| `page` / `per_page` | Pagination (default `per_page:25`) |

```
request({ provider:"apollo", method:"POST", path:"/api/v1/mixed_people/search",
          body:{ person_titles:["VP of Sales","Head of Revenue"],
                 organization_num_employees_ranges:["20,500"],
                 contact_email_status:["verified"], page:1, per_page:25 } })
```

Search results carry Apollo `id`s but **not** verified emails — those
come from enrichment. Paginate sequentially: read the response
`pagination` object (`{ page, per_page, total_entries, total_pages }`)
and increment `page` one call at a time until `page >= total_pages`.

### Get the ICP before searching

The pitch deck's "Who we sell to" section defines the ICP — use it
(B2B SaaS, 20–500 employees, Series A–C; VP Sales / VP Ops / Head of
Support / founders). Never pass placeholder values. If a real filter
value is missing and the persona doesn't supply it, ask the user.

## Enrich a person (burns credits — be deliberate)

`POST /api/v1/people/match` — reveals one person's contact info. Pin to
ONE person with the Apollo `id` from a prior search (cleanest), or
`first_name`+`last_name`+`domain`, or `email`, or `linkedin_url`.

| Param | Effect |
|---|---|
| `reveal_personal_emails` | `true` to reveal personal email — consumes credits |
| `reveal_phone_number` | `true` to reveal a phone — consumes credits, needs `webhook_url` |

```
request({ provider:"apollo", method:"POST", path:"/api/v1/people/match",
          body:{ id:"<person_id_from_search>" } })
```

**Bulk:** `POST /api/v1/people/bulk_match` with `details:[{…},…]` (up to
10) enriches several in ONE call — use it instead of 10 `match` calls.

## Rules

- A lead is usable only with a **verified** email
  (`email_status: "verified"`). Drop or park anything else.
- Record the Apollo person `id` and organization `id` with each lead —
  the news-research and linkedin-prospecting skills key off them.
- Don't enrich an entire search page reflexively — it burns credits.
  Search → let the user pick the leads worth contacting → enrich those.
- One Apollo `request(...)` at a time. People at multiple companies →
  one `mixed_people/search` with several `organization_ids`, not a loop.

## Errors — what to do

| Status | Do |
|---|---|
| 401 | Bad/missing key — tell the user to reconnect Apollo at /integrations. Don't retry. |
| 422 | Validation failed (often a placeholder or bad id) — read the message, fix the arg or ask. Don't resend the same body. |
| 429 | Rate limited (or too many parallel calls) — stop, go one call at a time, back off, retry. |
| 200 + empty | Filters too narrow — broaden one at a time. Don't immediately report "no results." |

## Output format

Produce a lead table: name, title, company, verified email, LinkedIn
URL, company signal(s), Apollo ids. Hand it to the `news-research` and
`linkedin-prospecting` skills for hook generation before any outreach.
