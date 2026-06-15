---
name: meta-ads
description: Use when creating, running, optimizing, or reporting on Meta (Facebook/Instagram) paid ad campaigns. Covers the campaign→ad-set→ad→creative assembly order, uploading creative, reading insights, pausing/scaling, and the hard budget + approval rules around spending money.
---

# Meta Ads

You run paid campaigns on Meta through the `metaads` tools. This spends
real money, so every create/raise-budget action is gated behind approval
and the monthly ceiling. Pausing is the one thing you may do on your own —
it only ever saves money.

## The funnel — assemble in this order

Meta's object model is nested. Build bottom-knowledge, create top-down:

1. `METAADS_CREATE_CAMPAIGN` — the campaign holds the **objective**
   (e.g. conversions, traffic, awareness) and overall budget strategy.
2. `METAADS_CREATE_AD_SET` — targeting, placements, schedule, and the
   **budget** (daily or lifetime). This is where spend is set.
3. `METAADS_UPLOAD_AD_IMAGE` — upload the creative image (by public URL
   from `share_file`); Meta returns an image hash.
4. `METAADS_CREATE_AD_CREATIVE` — assemble the creative: the uploaded image
   hash + primary text + headline + link/CTA.
5. `METAADS_CREATE_AD` — bind the creative to the ad set. This is the live
   ad.
6. `METAADS_PREVIEW_AD_CREATIVE` — render a preview to include in the
   approval before anything goes live.

Audiences: `METAADS_CREATE_CUSTOM_AUDIENCE` for retargeting/lookalikes.
Read existing sets with `METAADS_READ_ADSETS`.

## Measure & optimize

- `METAADS_GET_INSIGHTS` — spend, impressions, clicks, CTR, conversions,
  CPA. Compute CAC (spend ÷ conversions) and ROAS (revenue ÷ spend) and put
  them in every report.
- `METAADS_PAUSE_CAMPAIGN` — pause underperformers **immediately, no
  approval needed** (it saves money). Resume with `METAADS_RESUME_CAMPAIGN`
  (resuming spends, so that needs approval).
- `METAADS_UPDATE_CAMPAIGN` — edits. Anything that raises budget is gated.

## Money rules — non-negotiable

1. **Approval before launch.** `launch_ad_campaign` is gated. Draft the
   whole campaign (objective, audience, budget, creative preview) and submit
   it for a human yes/no. Never call `METAADS_CREATE_CAMPAIGN` /
   `_CREATE_AD` on your own.
2. **Respect the ceiling.** The monthly cap is the one set in the
   brand-and-safety policy (your knowledge base). Before proposing any
   budget, total the month-to-date committed spend across live campaigns
   (from insights + the ledger) and make sure the new or raised budget
   keeps the month under that ceiling. If it wouldn't, stop and tell the
   owner — propose a smaller budget instead.
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
- The creative (preview) and the primary text / headline / CTA
- What "working" looks like (target CAC/ROAS) and the review date
