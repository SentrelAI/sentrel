---
name: apollo-prospecting
description: Use when searching for leads, enriching contacts, or enrolling prospects into sequences via Apollo. Apollo is wired via Composio OAuth — no separate API key.
---

# Apollo Prospecting

Apollo's tools come from Composio (org-level OAuth) — there is no separate API key. If you call `secrets.get` for `APOLLO_API_KEY` and the engine says "Apollo is already connected via Composio," that's the truth: use the `APOLLO_*` tools, don't ask for a key.

## Tool names (use these EXACTLY)

The Composio Apollo toolkit exposes (verified names — case-sensitive):

| Tool | What it does |
|------|------|
| `APOLLO_PEOPLE_SEARCH` | Search people by title, location, company size, industry |
| `APOLLO_ORGANIZATION_SEARCH` | Search companies by domain, industry, employee count |
| `APOLLO_MIXED_PEOPLE_AND_ACCOUNTS_SEARCH` | One call returning both people + their orgs |
| `APOLLO_SEARCH_CONTACTS` | Search contacts you've previously saved in Apollo |
| `APOLLO_BULK_PEOPLE_ENRICHMENT` | Get emails/phones for up to 10 people at once |
| `APOLLO_CREATE_CONTACT` | Save a contact into your Apollo workspace |
| `APOLLO_ADD_CONTACTS_TO_SEQUENCE` | Enroll contacts into a SPECIFIC existing sequence |
| `APOLLO_GET_AUTH_STATUS` | Sanity-check the OAuth connection |

**Tool-name pattern**: `APOLLO_<NOUN>_<VERB>` — the noun (PEOPLE, ORGANIZATION, CONTACTS) comes BEFORE the verb (SEARCH, ENRICHMENT). If you find yourself typing the verb in the middle, you've reversed it. Only use names from the table above; if a tool isn't listed there, it doesn't exist.

## Searching for people — the right way

`APOLLO_PEOPLE_SEARCH` takes filter arrays. Pass arrays even for a single value:

```json
{
  "person_titles": ["Chief Medical Officer", "Practice Administrator", "Medical Director"],
  "person_locations": ["United States"],
  "organization_num_employees_ranges": ["1,10", "11,50", "51,200"],
  "q_organization_keyword_tags": ["healthcare", "medical practice", "primary care"],
  "per_page": 25,
  "page": 1
}
```

Per-page: `25` is the right default. Don't fetch `200` — you'll burn credits and the user only needs the top results.

## ICP — get the criteria BEFORE you call the tool

`APOLLO_PEOPLE_SEARCH` rejects requests with placeholder values. **Never** pass `"placeholder"`, `"test"`, `"example"`, `"TODO"` as a string value. If you don't have a real value for a required parameter, ASK THE USER instead of guessing.

Minimum information you need before the first call:
- **Titles** — what role/seniority are we targeting?
- **Industry / keywords** — what kind of company?
- **Company size** — solopreneur, SMB, mid-market, enterprise?
- **Location** — country / state / city restriction?

If your agent persona already names the ICP in the instructions (most SDR agents do — ScribeMD's SDR knows it's "family medicine, internal medicine, psychiatry, dermatology, urgent care, 1–15 physicians, US"), USE THAT — don't re-ask. If the persona is silent on ICP, ask the user before any search call.

## Enriching a person

`APOLLO_BULK_PEOPLE_ENRICHMENT` takes up to 10 at a time. Each entry needs at least:
- `name` + `domain` (or `organization_name`), OR
- `email` (full or partial), OR
- `linkedin_url`

If you have only "Jane Smith at Acme" with no email/domain/LinkedIn, search first via `APOLLO_PEOPLE_SEARCH` — enrichment expects identifying info that already pins to one person.

## Sequences (cadence enrollment)

To enroll into a sequence:

1. Call `APOLLO_LIST_SEQUENCES` first to get the real sequence_id (looks like `seq_abc123def`, NOT `"placeholder"`).
2. **If no sequence exists**, tell the user — don't create one without explicit ask.
3. Pass the real `sequence_id` + the array of contact_ids you got from `APOLLO_PEOPLE_SEARCH` / `APOLLO_SEARCH_CONTACTS` to `APOLLO_ADD_CONTACTS_TO_SEQUENCE`.

If you call `APOLLO_ADD_CONTACTS_TO_SEQUENCE` with `sequence_id: "placeholder"` you'll get HTTP 422 `Parameters misconfigured. placeholder is not a valid ID`. That's the error telling you you guessed.

## Workflow

1. **Read the persona's ICP**, or ask the user if it's not defined.
2. `APOLLO_PEOPLE_SEARCH` with real, specific filters (titles, location, employee_range, industry keywords).
3. Score the top 5–10 results by buying signals — recent funding, recent hires, tech stack matches, growth indicators.
4. If emails are missing, `APOLLO_BULK_PEOPLE_ENRICHMENT` (10 at a time) to fill them in.
5. Hand the list back to the user in a readable table (name, title, company, email if found, why each fits).
6. Only enroll into a sequence after the user confirms WHICH sequence and approves the list.

## Troubleshooting

- **422 "Parameters misconfigured"** → check your args for placeholder strings. Don't retry the same payload; either ASK the user for the missing value or pull it from a prior tool result.
- **"connectedaccountnotfound" / 401 / 403** → the Composio Apollo connection was revoked. Call `propose_connection` with `service: "apollo"` (Composio OAuth) so the user can reconnect — DON'T ask for an API key.
- **Empty results** → broaden filters one at a time: drop location restriction, widen employee range, swap keyword tags. Don't immediately tell the user "no results" — Apollo is fussy.
- **Tool not found error** → re-check the tool name from the table above. The pattern is `APOLLO_<NOUN>_<VERB>`. If you typed the verb in the middle, you've reversed it.

## Don't

- Don't web-search for a prospect when Apollo is connected.
- Don't ask for `APOLLO_API_KEY` — it's OAuth-based via Composio. The engine will reject the request and remind you.
- Don't pass placeholder strings — ask the user instead.
- Don't bulk-enroll into a sequence without explicit user approval.
- Don't claim "Apollo isn't working" because of 422 errors — those mean your args are wrong, not that the integration is broken.
