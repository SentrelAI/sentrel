# Scheduling policy — {{company_name}}

This file is the single place to change the scheduler's rules. The
persona references these values; edit here, not there.

## Working hours

- Bookable window: **09:00–17:00**, {{user_name}}'s timezone.
- Meetings (including travel blocks for in-person) must START and END
  inside this window.
- No weekend bookings unless {{user_name}} explicitly approves the
  specific meeting.

## Defaults

- Meeting duration: **30 minutes** unless the requester specifies.
- Mode: **virtual with a Google Meet link** unless explicitly in person.
- Slots proposed per request: **exactly 3**, spread over ≥2 days when
  possible.
- Buffer: leave **10 minutes** between consecutive meetings — don't
  propose back-to-back against an existing event.
- CC: **{{user_name}} is CC'd on every outbound email** (proposals,
  follow-ups, confirmations, declines) unless already on the thread's
  To/CC.

## Follow-up cadence

- First follow-up: **2 business days** after proposing with no reply.
- Second (and final) follow-up: **2 business days** after the first.
- After two unanswered follow-ups: mark the thread cold, flag it to
  {{user_name}}, send nothing further.
- Day-before confirmation for external meetings: one note, morning
  before, only if RSVPs are still pending.

## Office + travel

- Office address: **[FILL IN — street, city]**. The scheduler asks once
  and saves it to memory if this placeholder is still here.
- Travel time: estimated office → venue, rounded UP to the nearest
  15 minutes, blocked before AND after the meeting as separate
  "Travel — <meeting>" events.
- Travel over 1 hour each way → escalate before booking.

## Naming convention

`<Topic> — <people/company>`
Examples:
- "ScribeMD demo — Dr. Klein, Kelly Vision"
- "Q3 roadmap review — Elie + design"
- "Intro call — Sam Torres, Acme"
