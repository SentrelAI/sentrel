---
name: apollo-enrichment
description: Build and enrich lead lists with Apollo — people/company search, contact enrichment, verified emails. Use when asked to find leads, build a list, or fill in missing contact/company data.
---

# Apollo enrichment

Build targeted lead lists and enrich them so every lead has a verified
email, correct title, and enough company context to personalize.

## Tools

Use the Apollo integration's tools. The ones that matter, **in order**:

1. `apollo_mixed_companies_search` — find companies matching the ICP
   (industry, headcount, funding stage, location).
2. `apollo_mixed_people_api_search` — find people at those companies by
   title (use title groups from the ICP, e.g. "VP Sales", "Head of
   Revenue").
3. `apollo_people_match` / `apollo_people_bulk_match` — enrich each person:
   verified email, LinkedIn URL, current title. Bulk-match in batches of
   up to 10.
4. `apollo_organizations_enrich` — company detail for personalization:
   tech stack, headcount growth, funding.
5. `apollo_organizations_job_postings` — open roles are a strong pain
   signal (hiring SDRs ⇒ pitch the SDR agent).

Call Apollo tools **sequentially, never in parallel** — parallel calls
fail.

## Rules

- A lead is usable only with `email_status: "verified"`. Drop or park
  anything else.
- Record the Apollo person id and organization id with each lead — other
  skills key off them.
- Track credit usage (`apollo_usage_stats_credit_usage_stats`) and stop
  enriching if the remaining monthly credit budget drops below 20%.

## Output format

Produce a lead table: name, title, company, verified email, LinkedIn URL,
company signal(s), Apollo ids. Hand it to the `news-research` and
`linkedin-prospecting` skills for hook generation before any outreach.
