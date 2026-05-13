---
slug: scribemd-articles
name: ScribeMD Articles publishing
description: Create, update, and delete blog posts on the ScribeMD marketing site
category: content
icon: rss
requires_connections: []
---

# ScribeMD Articles publishing

Create, update, or delete blog articles on the ScribeMD marketing
site (https://www.scribemd.ai/articles).

## When to use

- "Publish a post", "draft an article", "update the blog post about X",
  "unpublish that post", or anything that mutates an article.
- The user has supplied a body, OR they've approved the body you drafted.

## When NOT to use

- For internal docs / knowledge — those go in the knowledge base.
- For reading an article — scrape `https://www.scribemd.ai/articles/<slug>`
  instead, the JSON API has no read endpoint.

## Auth

```
secrets.get({ provider: "scribemd_articles" })
```

The value is the API key. Use it as a Bearer token:

```
Authorization: Bearer <api_key>
Content-Type: application/json
```

If `secrets.get` returns `no access`, ask the user to grant this
agent the `scribemd_articles` credential at
`/agents/:id/edit → Permissions → Credentials`. Don't try to call
the API without it.

## Endpoints

Base URL: `https://api.scribemd.ai/api/v1/articles`

| Op     | Method | Path     | Body                       |
|--------|--------|----------|----------------------------|
| Create | POST   | `/`      | `{ "article": { ... } }`   |
| Update | PATCH  | `/:slug` | `{ "article": { ... } }`   |
| Delete | DELETE | `/:slug` | none                       |

There is no read endpoint. Public pages render via the Rails
`ArticlesController`.

## Article fields (permitted)

- `title` (required) — display title.
- `slug` (required) — URL identifier. **MUST match `^[a-z0-9-]+$`**.
  Lowercase letters, digits, hyphens only. No underscores, accents,
  spaces, uppercase.
- `author` (required) — display author name. Default `"ScribeMD"`
  when not specified.
- `body` — markdown or HTML; rendered as-is by the show view.
- `excerpt` — 1–2 sentence summary for the listing card.
- `published_date` — `YYYY-MM-DD`. **Always set when publishing** —
  the index sorts by this. Use today's date in the user's tz unless
  they say otherwise.
- `published` — boolean. **Default to `false` on create** so the
  user can review.
- `meta_title` — SEO `<title>` override. Blank → falls back to `title`.
- `meta_description` — SEO meta description override. Blank → falls
  back to `excerpt`.

Anything else is silently dropped — don't try to send other fields.

## Workflow: draft → review → publish

1. User asks for a post. Write the body or use the one they gave.
2. **Create with `published: false`**. Hand back the slug + a short
   summary. Drafts aren't publicly visible, so don't promise a URL.
3. On user go-ahead: `PATCH /:slug` with `{ "published": true,
   "published_date": "<today>" }`. Then give them the live URL:
   `https://www.scribemd.ai/articles/<slug>`.

## Idempotent upsert

If you don't know whether the slug exists, do the dance:

1. Try `PATCH /:slug` with the payload.
2. On `404`: `POST /` with the same payload (slug included).

This avoids `422 Slug has already been taken` from POSTing into
an existing slug.

## Slug generation

Slug is derived from the title. Examples:

- "How AI scribes save 2 hours a day" → `ai-scribes-save-2-hours-a-day`
- "Five mistakes new SDR teams make" → `five-mistakes-new-sdr-teams-make`
- "Q3 product update" → `q3-product-update`

Rule of thumb:
- lowercase the title
- strip punctuation
- replace whitespace with single hyphens
- collapse repeated hyphens
- trim leading/trailing hyphens
- if it ends up empty or > 80 chars, pick a shorter angle

Validate against `^[a-z0-9-]+$` before sending. If it fails, fix
locally — never send a slug the API will reject.

## Examples

### Create a draft

```bash
curl -X POST https://api.scribemd.ai/api/v1/articles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "article": {
      "title": "AI scribes save 2 hours a day",
      "slug": "ai-scribes-save-time",
      "author": "ScribeMD",
      "excerpt": "How clinicians reclaim hours with ambient AI.",
      "body": "# Intro\n\nWhen a clinician opens their EHR...",
      "published": false
    }
  }'
```

Response: `201 Created` with the article JSON. Save the `slug`.

### Publish it

```bash
curl -X PATCH https://api.scribemd.ai/api/v1/articles/ai-scribes-save-time \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "article": {
      "published": true,
      "published_date": "2026-05-13",
      "meta_title": "AI scribes save 2 hours a day | ScribeMD",
      "meta_description": "How clinicians reclaim hours with ambient AI."
    }
  }'
```

### Delete (after explicit user confirmation)

```bash
curl -X DELETE https://api.scribemd.ai/api/v1/articles/ai-scribes-save-time \
  -H "Authorization: Bearer $TOKEN"
```

## Error responses

- `401 Unauthorized` — token missing or wrong. Re-fetch via
  `secrets.get`; if still 401, ask the user to rotate the credential.
- `404 Not Found` — slug doesn't exist. Used to detect upsert path.
- `422 Unprocessable Entity` — validation failure. Body shape:
  `{ "errors": ["Slug has already been taken", ...] }`. Show the
  message to the user and fix the field they flagged.

## Rules

- **Never print the API key** in your reply or the article body.
- **Don't change a published article's slug** — public URLs use it
  and there's no redirect plan. Spin up a new article if the title
  really needs to shift.
- **Always set `published_date` when flipping `published` to true.**
  Without it the article saves but sorts last in the listing.
- **Confirm before DELETE.** Show the slug + title and ask
  "Delete `<title>` permanently? This can't be undone." before
  calling DELETE.
- **Body format**: if unsure markdown vs HTML, use markdown. The
  show view renders the body as-is.
