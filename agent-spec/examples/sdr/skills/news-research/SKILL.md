---
name: news-research
description: Find timely company news (funding, launches, hires, incidents) via the Perplexity API to use as personalization hooks. Use when building hooks for a lead list or qualifying account momentum.
---

# News research

Recent company news is the best cold-email hook there is: it's public,
it's flattering to have noticed, and it ties the pitch to something
happening *now*.

## Workflow (per company)

Using the `perplexity` MCP tools:

1. Query: `"<company name>" funding OR launch OR partnership OR hiring`,
   restricted to the last 90 days.
2. Classify what comes back:
   - **Funding round** → growth pressure; pitch scaling the team without
     headcount.
   - **Product launch** → support/ops load incoming; pitch absorbing the
     spike.
   - **Hiring spree (esp. SDR/support roles)** → they're already paying
     for this problem; strongest signal we have.
   - **Leadership change** → new exec, new tooling budget, 90-day window.
3. Record: one-line summary, date, source URL, and the signal class in
   the lead table.

## Rules

- A hook must be ≤ 90 days old and from a citable source. No source URL,
  no hook.
- Never reference negative news (layoffs, breaches, lawsuits) in
  outreach. Use it only internally for timing/qualification.
- If Perplexity returns nothing, fall back to the company's own
  blog/changelog before declaring "no hook".
- One news query per company per list-build — don't burn API budget
  re-researching the same account within 30 days.
