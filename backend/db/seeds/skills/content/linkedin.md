---
slug: linkedin
name: LinkedIn
description: Get the authenticated LinkedIn member and publish text or article shares to their feed via the LinkedIn REST API.
category: marketing
icon: linkedin
requires_connections:
  - linkedin
---

# LinkedIn

Call the LinkedIn REST API with the **`request`** tool (server `apps`):

```
request({ provider: "linkedin", method, path, query?, body? })
```

- **Base is `https://api.linkedin.com`** — give `path` relative, starting with `/` (e.g. `/v2/userinfo`).
- **Auth is injected for you.** NEVER ask for, include, or echo a token/OAuth credential.
- **Don't use any LinkedIn SDK or scrape linkedin.com.** Every action goes through `request(...)`.
- The tool result is `{ status, body }`. Read `body` for the JSON payload.
- **Posting requires the header `X-Restli-Protocol-Version: 2.0.0`.** Send it on `POST /v2/ugcPosts` (and the assets API). Pass it via `headers` on the request.

## READ THIS FIRST — what you actually have access to

LinkedIn's API is **heavily gated**. With a normal member OAuth connection you have exactly three "Open" permissions and nothing more:

| Scope | Grants |
|---|---|
| `openid` / `profile` | Read the authenticated member's name, headline, photo (`GET /v2/userinfo`). |
| `email` | Read the member's primary email. |
| `w_member_social` | Post / comment / like **on behalf of the authenticated member** (`POST /v2/ugcPosts`). |

**Everything else needs LinkedIn Partner Program approval that this connection almost certainly does NOT have:**

- **Company / organization pages** (posting as a company, page admin, follower stats) → Community Management API, partner-gated.
- **Analytics / post metrics / impressions / social actions counts** → Marketing API, partner-gated.
- **Ads / campaigns / audiences** → Advertising API (Marketing Partner), approval required.
- **Messaging / InMail / connections list / "my network"** → no open scope exists; SNAP/partner only.
- **Sales Navigator, Recruiter, Learning** → separate partner programs.

So the realistic job here is: **identify the member, then publish a text or article share to their personal feed.** If the user asks for company-page posting, analytics, DMs, or connection data, say up front it's not available on this connection (see the 403 row in Errors) — don't fake it or burn calls discovering it.

## The member URN — get it first, every time

Posting requires the author's **Person URN** (`urn:li:person:{id}`). You can't post without it, so resolve it before the first share.

| Do | Call |
|---|---|
| Get the authenticated member (OpenID) | `GET /v2/userinfo` → `body.sub` is the member id; also `name`, `email`, `picture`. |
| Get the authenticated member (legacy) | `GET /v2/me` → `body.id` is the member id. |

```
request({ provider:"linkedin", method:"GET", path:"/v2/userinfo" })
// → body: { sub:"8675309", name:"Jane Doe", email:"jane@acme.com", picture:"..." }
// Build the author URN:  "urn:li:person:8675309"
```

> Use `body.sub` (from `/v2/userinfo`) — that id is the same value that goes into `urn:li:person:{id}`. If `/v2/userinfo` 403s (missing `openid`/`profile`), fall back to `/v2/me` and read `body.id`.

## Create a text share

`POST /v2/ugcPosts` with `headers:{ "X-Restli-Protocol-Version":"2.0.0" }`.

```
request({
  provider:"linkedin", method:"POST", path:"/v2/ugcPosts",
  headers:{ "X-Restli-Protocol-Version":"2.0.0" },
  body:{
    author: "urn:li:person:8675309",
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: "Hello World! My first Share on LinkedIn." },
        shareMediaCategory: "NONE"
      }
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
  }
})
// → 201 Created. The new post id is in the X-RestLi-Id response header.
```

Required fields (all of them, or you get a 422):

| Field | Value |
|---|---|
| `author` | `"urn:li:person:{id}"` — the member URN from above. |
| `lifecycleState` | Always `"PUBLISHED"` to publish. |
| `specificContent."com.linkedin.ugc.ShareContent".shareCommentary.text` | The post text. |
| `specificContent."com.linkedin.ugc.ShareContent".shareMediaCategory` | `"NONE"` (text-only), `"ARTICLE"` (URL), or `"IMAGE"`. |
| `visibility."com.linkedin.ugc.MemberNetworkVisibility"` | `"PUBLIC"` (anyone) or `"CONNECTIONS"` (1st-degree only). |

> Those dotted keys (`com.linkedin.ugc.ShareContent`, `com.linkedin.ugc.MemberNetworkVisibility`) are **literal object keys**, not paths — the JSON nesting must match exactly. This is the most common reason a post 422s.

## Create an article / URL share

Same shape as a text share, but set `shareMediaCategory: "ARTICLE"` and add a `media[]` entry with the URL. `title` and `description` are optional.

```
request({
  provider:"linkedin", method:"POST", path:"/v2/ugcPosts",
  headers:{ "X-Restli-Protocol-Version":"2.0.0" },
  body:{
    author: "urn:li:person:8675309",
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: "Worth a read 👇" },
        shareMediaCategory: "ARTICLE",
        media: [{
          status: "READY",
          originalUrl: "https://blog.linkedin.com/",
          title: { text: "Official LinkedIn Blog" },
          description: { text: "Insights and information about LinkedIn." }
        }]
      }
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
  }
})
```

> Each `media` entry needs `status: "READY"`. For an `ARTICLE`, `originalUrl` is the link; LinkedIn fetches the preview. Do not set the `media.media` (asset URN) field for an article — that's only for uploaded images.

## Image share (multi-step — only if asked)

Text and article shares are one call. An **image** share is three steps and is only worth it when the user explicitly wants an image attached:

1. **Register:** `POST /v2/assets?action=registerUpload` · `body:{ registerUploadRequest:{ recipes:["urn:li:digitalmediaRecipe:feedshare-image"], owner:"urn:li:person:{id}", serviceRelationships:[{ relationshipType:"OWNER", identifier:"urn:li:userGeneratedContent" }] } }` → response gives `value.uploadMechanism...uploadUrl` and `value.asset`.
2. **Upload** the image binary to that `uploadUrl` (a raw file PUT/POST). This is outside the JSON `request(...)` shape; if you can't stream a binary through the tool, tell the user image upload isn't supported here and offer a text or article share instead.
3. **Post:** same `ugcPosts` call with `shareMediaCategory: "IMAGE"` and `media:[{ status:"READY", media:"<asset URN from step 1>", title, description }]`.

## Approval gate for posting

A LinkedIn post is a public, on-the-record action under the user's own name. **Gate every share behind `request_approval`** (`payload_type` of the post text/URL) so the user reviews the exact wording before it's published. Don't auto-publish, and don't post on a schedule without the user confirming the content.

## Rate limits

| Throttle | Daily limit (UTC) |
|---|---|
| Per member | ~150 requests/day |
| Per application | ~100,000 requests/day |

The member budget is small — don't poll or retry in a loop. One `userinfo` + one `ugcPosts` per post is the whole flow.

## Errors — what to do

| Status | Meaning | Do |
|---|---|---|
| 401 | Bad/expired token | Connection issue — tell the user to reconnect LinkedIn at /integrations. Don't retry. |
| 403 | **Scope OR partner approval missing** | This is the big one. It usually means the connection lacks `w_member_social` (posting) OR you're hitting a partner-gated API (company pages, analytics, ads, messaging) the account isn't approved for. **This is NOT a reconnect-and-retry situation** — most 403s here can't be fixed by reconnecting. Read `body.message`: if it's about `w_member_social`, the user can add the "Share on LinkedIn" product to their app; if it's a company/analytics/ads/messaging endpoint, tell the user that capability requires LinkedIn Partner Program approval this connection doesn't have, and stop. |
| 422 | Validation failed | Almost always the `ugcPosts` body shape — check the literal `com.linkedin.ugc.*` keys, the `urn:li:person:{id}` author, and that all required fields are present. Fix and retry once. |
| 426 / "protocol version" | Missing `X-Restli-Protocol-Version` | Add `headers:{ "X-Restli-Protocol-Version":"2.0.0" }` to the request. |
| 429 | Throttled | You've hit the ~150/day member cap or a burst limit. Stop — don't loop-retry; the daily cap won't clear by retrying. |
| 404 | Not found | The URN or post id is wrong, or it's a gated resource the account can't see. Don't assume a bug — re-resolve the member URN. |

## Don't

- Don't try to post, read, or analyze **company / organization pages** — that's the partner-gated Community Management API, not available here.
- Don't promise **analytics, impressions, follower counts, DMs, or connection lists** — no open scope grants them; say so instead of probing.
- Don't post without the **member URN** (`urn:li:person:{id}`) as `author`, or without the `X-Restli-Protocol-Version: 2.0.0` header.
- Don't treat a **403 as a reconnect problem** — it's usually a missing scope or partner approval, which reconnecting won't fix.
- Don't auto-publish — gate shares behind `request_approval` so the user sees the exact text first.
- Don't loop-retry on 429 — the per-member daily budget is ~150 requests.
- Don't ask the user for a token — auth is already connected.
