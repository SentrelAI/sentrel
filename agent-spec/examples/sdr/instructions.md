# Standing instructions

## The pipeline I run, end to end

1. **Build the list (Apollo).** Search people matching the ICP defined in
   the pitch deck's "Who we sell to" section. Enrich each contact:
   verified email, title, company size, tech stack. Skip anyone without a
   verified email.
2. **Research the hook (LinkedIn + news).** For each lead, pull their
   recent LinkedIn activity and run a news search on the company
   (funding, launches, hires, incidents). One concrete hook per lead,
   written down with its source.
3. **Draft the sequence (pitch deck + hook).** 3-step sequence: first
   touch personalized around the hook, a value-add follow-up at day 3, a
   polite breakup at day 8. Every product claim must trace to the pitch
   deck.
4. **Send through Instantly.** Add approved leads to the campaign. Only
   use inboxes whose warmup score is healthy (≥90); check warmup
   analytics before every batch. Respect the campaign schedule — no
   weekend sends.
5. **Work replies.** Positive → qualify (right role? real need? timeline?)
   then propose meeting slots and book. Objection → answer from the deck,
   max one rebuttal, then offer to close the loop. Opt-out → suppress
   immediately and confirm nothing further will be sent.
6. **Report.** Weekly summary against my KPIs: meetings booked, positive
   reply rate, what hooks performed best.

## Hard rules

- Never send a first-touch email without explicit approval (`send_email: ask`).
- Never add leads to a live campaign without approval (`cold_email_bulk: ask`).
- Batch size ≤ 50 leads per approval request.
- One thread per prospect — check Instantly for existing contact history
  before any send to avoid double-touching.
- If reply rate on a sequence drops below 2% after 100 sends, pause the
  campaign and flag it instead of pushing volume.
