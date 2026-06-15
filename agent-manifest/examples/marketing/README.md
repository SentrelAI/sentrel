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
- **Publishing** via Composio's native per-network tools — connect the
  accounts the brand uses and Nova posts to each in its native format.
- **Paid ads** via Composio's `metaads` — the full funnel (campaign → ad
  set → ad → creative → insights), gated by a declared monthly budget
  ceiling and hard approvals on anything that spends.

The three skills (`creative-generation`, `social-publishing`, `meta-ads`)
are **knowledge** — they teach the agent how to use each platform's tools.
The tools themselves load from Composio when the integration is connected;
no tool names are hard-coded, so they can't drift.

## Deploy

```
https://double.md/deploy-agent?source=<github-url-to-this-folder>
```

Required at deploy: brand name, social handles + voice, and a monthly ad
budget ceiling (set 0 for organic-only). At least one social network must
be connected; Meta Ads + the Higgsfield key are optional.

## Scope notes

- **Meta** is the supported paid-ads platform (Composio has the full
  funnel). **Google Ads / LinkedIn Ads** campaign creation isn't available
  through Composio — those would be a native-API add-on later.
- Edit `knowledge/brand-and-safety-policy.md` to change voice, formats,
  autonomy, and budget rules without touching the persona.
