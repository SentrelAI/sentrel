# Nova — growth & creative marketer bundle

A full-funnel marketing agent: generates on-brand creative (images +
video), publishes natively to TikTok / Instagram / Facebook / YouTube /
LinkedIn, and launches + optimizes Meta ad campaigns within a budget — all
with human approval before anything posts publicly or spends money.

## How it works

- **Creative** via the engine's built-in image/video capabilities — uses
  **Higgsfield** when a `HIGGSFIELD_API_KEY` is set, otherwise falls back to
  the workspace's other generator (Flux/Runway/Luma/Veo). Assets become
  public URLs via `share_file` for posting/ads.
- **Publishing** via the apps tool — Nova calls each network's REST API
  through `mcp__apps__request({ provider, method, path, ... })`, where
  `provider` is the network slug (`linkedin`, `instagram`, `facebook`,
  `youtube`, `tiktok`). Connect the accounts the brand uses at /integrations
  and Nova posts to each in its native format. OAuth tokens are injected by
  Rails — no credentials in the agent.
- **Paid ads** via the **Meta Ads MCP** (`mcp__meta_ads__*`) — the full
  funnel (campaign → ad set → ad → creative → insights), gated by a declared
  monthly budget ceiling and hard approvals on anything that spends. This is
  the one app that does NOT go through the apps proxy.

- **Email** via Gmail (`provider: google-mail`, the raw RFC822 send) for
  low-volume mail, or a connected ESP (Mailchimp/SendGrid/etc.) via the apps
  tool for bulk newsletters.

The five skills (`creative-generation`, `social-publishing`, `meta-ads`,
`email-newsletters`, `ugc-ads`) are **knowledge** — they teach the agent
the real endpoints to call through the apps tool (or the Meta Ads MCP), in
what order, and the gotchas. Nothing hard-codes credentials; auth is
injected when the app is connected at /integrations.

## Deploy

```
https://sentrel.ai/deploy-agent?source=<github-url-to-this-folder>
```

Required at deploy: brand name, social handles + voice, and a monthly ad
budget ceiling (set 0 for organic-only). At least one social network must
be connected; Meta Ads + the Higgsfield key are optional.

## Scope notes

- **Meta** is the supported paid-ads platform (the Meta Ads MCP has the full
  funnel). **Google Ads / LinkedIn Ads** campaign creation isn't wired up
  yet — those would be a per-app add-on later.
- Edit `knowledge/brand-and-safety-policy.md` to change voice, formats,
  autonomy, and budget rules without touching the persona.
