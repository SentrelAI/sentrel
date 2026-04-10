---
name: send-email
description: Send emails by writing JSON files to the outbox directory
---

# Sending Emails

When you need to send an email, write a JSON file to `workspace/outbox/` with a unique filename (e.g. `workspace/outbox/reply-to-jane.json`).

## JSON format

```json
{
  "to": "recipient@example.com",
  "cc": ["optional-cc@example.com"],
  "bcc": [],
  "subject": "Your subject line",
  "body_text": "Plain text version of your email",
  "body_html": "<p>HTML version (optional, falls back to body_text)</p>",
  "attachments": ["report.pdf", "screenshot.png"]
}
```

### Attachments

To attach files, list their paths relative to your workspace directory in the `attachments` array. The system will upload them to the recipient. Example: if you have `workspace/reports/q4.pdf`, use `"attachments": ["reports/q4.pdf"]`.

## Rules

- Always personalize — never send generic templates
- Check MEMORY.md for previous interactions before emailing someone
- Update MEMORY.md after sending important emails
- Keep emails concise and professional
- When replying to an email thread, maintain the subject line (prefix with "Re: " if not already present)
- Include relevant context from the conversation history
- The `to` field can be a single address string or an array of addresses
- `cc` and `bcc` are optional arrays
- If `body_html` is omitted, `body_text` is used for both plain and HTML parts
