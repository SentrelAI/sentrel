---
name: email-newsletters
description: Use when sending newsletters, lifecycle/transactional emails, or one-off marketing emails. Covers sending through Gmail via the apps proxy (the raw RFC822 send) or a connected ESP, and the hard rule that actually SENDING to a list needs approval.
---

# Email newsletters

You send email by calling a connected app's REST API through the
**`request`** tool (server `apps`):

```
request({ provider, method, path, query?, body? })
```

Auth is injected for you — never ask for or echo a token. The result is
`{ status, body }`.

There are two paths depending on what's connected:

- **Gmail** (`provider: "google-mail"`) — best for low-volume sends from a
  workspace address: a personal note, a small lifecycle email, a test. Use a
  domain-verified workspace address, not a personal Gmail, for anything
  list-shaped.
- **A dedicated ESP** (Mailchimp, SendGrid, Customer.io, etc., reached via
  the proxy with that app's slug) — for true bulk newsletters to a list.
  These have proper list management, unsubscribe handling, and deliverability
  that a raw Gmail send doesn't. Connect the ESP at /integrations and use its
  REST API the same way.

## Sending through Gmail (the raw RFC822 send)

Gmail's send takes a full RFC 822 email **base64url-encoded** into `raw`.
Build the message (headers + blank line + body), base64url-encode it, then:

```
request({ provider:"google-mail", method:"POST",
  path:"/gmail/v1/users/me/messages/send",
  body:{ raw:"<base64url of the RFC822 message>" } })
```

The RFC 822 you encode looks like:

```
To: subscriber@example.com
Subject: Our biggest sale yet ☀️
Content-Type: text/html; charset="UTF-8"

<h1>Spring sale</h1><p>…</p>
```

- **HTML email:** set `Content-Type: text/html; charset="UTF-8"`.
- **base64url, not standard base64** (`-`/`_`, padding optional) — a plain
  base64 `raw` will 400.
- **One recipient per send** for personalized lifecycle mail; for a small
  list, loop and send per subscriber so each gets a clean To: line. For a
  real bulk blast, use an ESP instead — don't fan out hundreds of Gmail
  sends.
- Prefer create-draft + send-draft for review-before-send:
  `POST /gmail/v1/users/me/drafts` · `body:{ message:{ raw } }`, then
  `POST /gmail/v1/users/me/drafts/send` · `body:{ id:"<draftId>" }`.

## Sending through an ESP (bulk newsletters)

When a true newsletter ESP is connected, the typical shape is: confirm the
target list, create the campaign as a **draft**, then a separate call
**sends** it. For example, against a Mailchimp-style API
(`provider: "mailchimp"`, base `https://<dc>.api.mailchimp.com`):

| Need | Method + path | Notes |
|------|---------------|-------|
| List audiences/lists | `GET /3.0/lists` | get the list id to target |
| Create a campaign | `POST /3.0/campaigns` | draft only — does NOT send |
| Set the content | `PUT /3.0/campaigns/{id}/content` | subject/body |
| **Send the campaign** | `POST /3.0/campaigns/{id}/actions/send` | THIS SENDS |
| Campaign report | `GET /3.0/reports/{id}` | opens, clicks, bounces |

Slugs/endpoints differ per ESP — check the connected app's docs — but the
pattern is the same: **draft first, send is a separate gated action.**

## Rules

1. **Drafting is free, sending is not.** Composing a message, creating a
   draft campaign, and reading reports are routine. Actually sending to a
   list (the ESP send action, or a Gmail send to subscribers) sends real
   mail — draft it, show the subject + audience + body preview, and get
   approval first (the `send_email` / publish gate).
2. **Target the right list.** Always list the audiences/lists and confirm
   the list id + subscriber count before drafting. Sending to the wrong list
   is not undoable.
3. **On brand.** Subject and body follow the brand voice in the
   brand-and-safety policy, same as social copy.
4. **Respect consent.** Only ever email people the brand has permission to
   email. Never import a purchased or scraped list. Don't send marketing
   blasts from a personal Gmail — use a domain-verified address or a real
   ESP.
5. **Report results.** After a send, pull the campaign report (or Gmail
   thread) and include opens/clicks/bounces in the weekly report alongside
   social and ad numbers.
