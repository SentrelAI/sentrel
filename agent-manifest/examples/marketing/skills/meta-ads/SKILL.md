---
name: meta-ads
description: Use when creating, running, optimizing, or reporting on Meta (Facebook/Instagram) paid ad campaigns. Covers the campaign→ad-set→ad→creative assembly order via the Meta Ads MCP, uploading creative, reading insights, pausing/scaling, and the hard budget + approval rules around spending money.
---

# Meta Ads

You run paid campaigns on Meta through the **dedicated Meta Ads MCP** —
tools named `mcp__meta_ads__*`. This is the one app that does NOT go through
the `mcp__apps__request` proxy; call its MCP tools directly. Spending real
money is gated behind approval and the monthly ceiling. Pausing is the one
thing you may do on your own — it only ever saves money.

First, resolve the ad account: `mcp__meta_ads__ads_get_ad_accounts` →
use the `act_<id>` you'll pass to the create calls.

## The funnel — assemble in this order

Meta's object model is nested. Create top-down:

1. `mcp__meta_ads__ads_create_campaign` — the campaign holds the
   **objective** (e.g. `OUTCOME_SALES`, `OUTCOME_TRAFFIC`,
   `OUTCOME_AWARENESS`) and starts paused.
2. `mcp__meta_ads__ads_create_ad_set` — targeting, placements, schedule, and
   the **budget** (`daily_budget` or `lifetime_budget`, in minor units /
   cents). This is where spend is set.
3. `mcp__meta_ads__ads_create_creative` — assemble the creative: the image
   (from `share_file`'s public URL or an uploaded image hash) + primary text
   + headline + link/CTA. Inspect uploaded images with
   `mcp__meta_ads__ads_get_ad_images`.
4. `mcp__meta_ads__ads_create_ad` — bind the creative to the ad set. This is
   the ad.
5. `mcp__meta_ads__ads_get_ad_preview` — render a preview to include in the
   approval before anything goes live.

Audiences: `mcp__meta_ads__ads_create_custom_audience` for
retargeting/lookalikes;
`mcp__meta_ads__ads_get_ad_account_custom_audiences` to list existing ones.

## Measure & optimize

- `mcp__meta_ads__ads_get_insights` — spend, impressions, clicks, CTR,
  conversions, CPA. Compute CAC (spend ÷ conversions) and ROAS (revenue ÷
  spend) and put them in every report. Industry context:
  `mcp__meta_ads__ads_insights_industry_benchmark`.
- **Pause / activate** with `mcp__meta_ads__ads_update_entity` (set
  `status:"PAUSED"`) — pausing underperformers needs **no approval** (it
  saves money). Activating/resuming spends, so that needs approval.
- `mcp__meta_ads__ads_update_entity` also edits budgets. Anything that
  raises a budget is gated.

## Money rules — non-negotiable

1. **Approval before launch.** `launch_ad_campaign` is gated. Draft the
   whole campaign (objective, audience, budget, creative preview) and submit
   it for a human yes/no. Never call `ads_create_campaign` /
   `ads_create_ad` to go live on your own. Campaigns are created paused;
   only activate after approval.
2. **Respect the ceiling.** The monthly cap is the one set in the
   brand-and-safety policy (your knowledge base). Before proposing any
   budget, total the month-to-date committed spend across live campaigns
   (from `ads_get_insights` + the ledger) and make sure the new or raised
   budget keeps the month under that ceiling. If it wouldn't, stop and tell
   the owner — propose a smaller budget instead.
3. **Start small.** New campaigns launch at a conservative daily budget.
   Scaling spend (raising budget, resuming, duplicating into a bigger set)
   is a separate `adjust_ad_budget` approval and only after the numbers
   prove out — positive ROAS or CAC under target.
4. **Pause is free, scale is earned.** Always pause a clearly losing
   campaign right away. Only ever scale a winner, and only with approval.
5. **Report spend honestly.** Every report shows spend vs. ceiling and the
   real CAC/ROAS, including the campaigns that are losing money.

## Launch checklist (put this in the approval)

- Objective + why it fits the brief
- Audience (interests / custom / lookalike) and placements
- Daily/lifetime budget + how it sits under the monthly ceiling
- The creative (preview from `ads_get_ad_preview`) and the primary text /
  headline / CTA
- What "working" looks like (target CAC/ROAS) and the review date
