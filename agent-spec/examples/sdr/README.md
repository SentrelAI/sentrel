# SDR example bundle — "Sarah"

The canonical Agent Bundle: a complete outbound SDR defined as a folder.
This is the "Dockerfile of AI agents" idea in practice — everything the
agent *is* lives in versionable plain files; everything secret stays out.

```
sdr/
├── agent.yaml                      # manifest — identity, goal, wiring
├── personality.md                  # how Sarah sounds and behaves
├── identity.md                     # who she is inside the company
├── instructions.md                 # the outbound pipeline she runs
├── knowledge/
│   └── pitch-deck.md               # source of truth for all product claims
└── skills/
    ├── apollo-enrichment/          # build + enrich lead lists
    ├── instantly-outreach/         # warm sending, campaigns, replies
    ├── linkedin-prospecting/       # per-prospect research hooks
    └── news-research/              # Perplexity news hooks
```

## What it demonstrates

| Requirement | Where |
| --- | --- |
| Own email address | `channels[0]` (`type: email`, `sarah@{{company_domain}}`) |
| Apollo for enrichment | `integrations` service `apollo` + `skills/apollo-enrichment` + `APOLLO_API_KEY` |
| Instantly with warm sending | `integrations` service `instantly` + `skills/instantly-outreach` (warmup-score gate ≥90) + `INSTANTLY_API_KEY` |
| Pitch deck | `knowledge/pitch-deck.md`, enforced by personality ("if it isn't in the deck, I don't say it") |
| Goal: book meetings | `goal.mission` + KPIs (5 meetings/week, 8% positive replies) + `definition_of_done` |
| LinkedIn | MCP integration `linkedin` + `skills/linkedin-prospecting` |
| News (Perplexity) | MCP integration `perplexity` + `skills/news-research` + `PERPLEXITY_API_KEY` |

## Safety posture

- `send_email: ask` / `cold_email_bulk: ask` — no outbound without approval
- `reply_email: auto` / `book_meeting: auto` — momentum where it's safe
- `delete_data: block`
- Secrets are declared by **name only**; the validator hard-fails on any
  value that looks like a credential.

## Try it

```sh
node bin/validate.mjs examples/sdr
```

Before deploying for real: replace the bracketed sections of
`knowledge/pitch-deck.md` with your actual deck, and point the MCP
transport URLs at your real LinkedIn/Perplexity MCP servers.
