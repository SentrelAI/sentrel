---
name: linkedin-prospecting
description: Research prospects on LinkedIn via the connected app — profile/company context for personalization hooks. Use before drafting any first-touch email, and be honest about the API's limits.
---

# LinkedIn prospecting

LinkedIn is for **research and light social touches**, not mass outreach.
The goal: one concrete, recent, true fact per prospect that makes the
first email obviously hand-written.

Call the LinkedIn API with the **`request`** tool (server `apps`):

```
request({ provider: "linkedin", method, path, query?, body? })
```

- **Base is `https://api.linkedin.com`** — give `path` relative,
  starting with `/` (e.g. `/v2/userinfo`).
- **Auth is injected for you.** The connected account's OAuth token is
  added automatically. NEVER ask for, include, or echo a token.

## Be honest: LinkedIn's API is heavily gated

LinkedIn does **not** expose a general "look up any prospect's profile
and recent posts" API. The public OAuth product (Sign In with LinkedIn /
`/v2/userinfo`) only returns the **connected user's own** basic profile.
Reading arbitrary members' activity, posts, or full profiles needs Sales
Navigator or an approved LinkedIn Partner Program product — which most
connected accounts don't have.

So, in order:

1. **Try the connected app** for anything the account is actually
   entitled to (e.g. the connected user's own profile, or company-page
   data the account admins). If a call returns 403, the account lacks
   that scope — don't keep retrying.
2. **When the API can't supply prospect data, fall back to the
   `news-research` skill** (built-in web search) for the hook. A public
   web search for "<name> <company> linkedin" plus the company's news is
   usually enough to write a genuinely personalized first line — without
   pretending to have scraped their feed.
3. Use the LinkedIn URL captured in the Apollo enrichment table as the
   canonical link; record the hook and its source there.

## Social touches

- Viewing a profile or following a prospect before the first email is
  fine and useful — but only if the connected product supports it.
- Connection requests and DMs follow the same approval rule as cold
  email: draft them, ask first. Most accounts can't send these via the
  API at all; if so, queue them for a human to send manually.

## Rules

- Read-only by default. No automated liking/commenting sprees — that
  pattern gets accounts restricted.
- One LinkedIn `request(...)` at a time; don't fan out parallel calls.
- Never claim to have read a prospect's posts if the API didn't return
  them — be honest internally and source the hook from the web instead.
- Never quote a prospect's post back at them verbatim; paraphrase like a
  human who actually read it.

## Errors — what to do

| Status | Do |
|---|---|
| 401 | Not connected / expired token — tell the user to reconnect LinkedIn at /integrations. Don't retry. |
| 403 | The account lacks the scope/product for this data (the common case). Fall back to news-research; don't loop. |
| 429 | Rate limited — stop, back off, retry sequentially. |
