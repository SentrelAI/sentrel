---
name: stealth-browser
description: Use when you need to browse websites that block bots, scrape protected pages, visit LinkedIn profiles, or interact with websites that require a real browser. This uses an anti-detection stealth browser.
---

# Stealth Browser (Camofox)

You have access to an anti-detection browser running at `http://localhost:9377`. Use it to browse websites that block automated access (LinkedIn, etc.) or when you need to interact with web pages.

## Create a tab and navigate
```bash
curl -s -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent","url":"https://example.com"}'
```
Returns `{"tabId":"..."}` — save this for subsequent actions.

## Get page snapshot (for reading content)
```bash
curl -s "http://localhost:9377/tabs/TAB_ID/snapshot?userId=agent"
```
Returns an accessibility snapshot — much smaller than raw HTML, includes element refs (e1, e2, etc.) for clicking.

## Click an element
```bash
curl -s -X POST http://localhost:9377/tabs/TAB_ID/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent","ref":"e5"}'
```

## Type text into a field
```bash
curl -s -X POST http://localhost:9377/tabs/TAB_ID/type \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent","ref":"e3","text":"search query here"}'
```

## Navigate to a URL
```bash
curl -s -X POST http://localhost:9377/tabs/TAB_ID/navigate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"agent","url":"https://linkedin.com/company/example"}'
```

## Take a screenshot
```bash
curl -s "http://localhost:9377/tabs/TAB_ID/screenshot?userId=agent" --output screenshot.png
```

## Search macros (shortcuts)
```bash
# Google search
curl -s -X POST http://localhost:9377/tabs/TAB_ID/navigate \
  -d '{"userId":"agent","macro":"@google_search","query":"healthcare startups Series A 2025"}'

# LinkedIn search
curl -s -X POST http://localhost:9377/tabs/TAB_ID/navigate \
  -d '{"userId":"agent","macro":"@google_search","query":"site:linkedin.com/company healthcare startup"}'
```

## Close tab when done
```bash
curl -s -X DELETE "http://localhost:9377/tabs/TAB_ID?userId=agent"
```

## Tips
- Always create a tab first, then use its tabId for all actions
- Use snapshot to read page content (not screenshot — snapshot is text-based)
- Close tabs when done to free memory
- For LinkedIn: use Google search with site:linkedin.com instead of browsing LinkedIn directly
- Element refs (e1, e2...) are stable identifiers for clicking/typing
