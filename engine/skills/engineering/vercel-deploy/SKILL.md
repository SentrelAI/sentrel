---
name: vercel-deploy
description: Use when deploying any site, app, or single HTML file to Vercel via the VERCEL_CREATE_DEPLOYMENT integration tool.
---

# Deploying to Vercel

## The mandatory flag

`VERCEL_CREATE_DEPLOYMENT` rejects new-project payloads with `400 missing_project_settings` unless you tell Vercel how to handle framework detection. There are two ways and you must pick one **on every call**:

1. **Skip auto-detection** (simplest, works for static sites): pass `skipAutoDetectionConfirmation: "1"` (or `1`) at the top level of the tool args.
2. **Specify projectSettings explicitly**: pass `projectSettings: { framework: <framework-or-null>, ... }`.

If you call without either, the deploy fails with the error above. Don't retry blindly — add the flag.

## Static single-file deploy (HTML/CSS/JS, no framework)

For "deploy this `index.html`" or any static drop, use:

```json
{
  "name": "<project-slug>",
  "skipAutoDetectionConfirmation": "1",
  "files": [
    { "file": "index.html", "data": "<full file contents as string>" }
  ],
  "projectSettings": { "framework": null }
}
```

- `name`: lowercase, hyphenated, ≤52 chars (`clinic-zubieta-2026`, not `Clinic Zubieta`).
- `files[*].data`: literal file contents inline. For multiple files, repeat the object — each gets its own `file` (path) + `data`.
- `framework: null` tells Vercel "static, no build step."

## Framework deploy (Next.js, Vite, etc.)

```json
{
  "name": "<project-slug>",
  "projectSettings": {
    "framework": "nextjs",          // or "vite", "create-react-app", "astro", "remix", ...
    "buildCommand": null,            // null = use framework defaults
    "outputDirectory": null,
    "installCommand": null
  },
  "files": [ ... ]
}
```

Don't guess framework names — common slugs: `nextjs`, `vite`, `astro`, `remix`, `nuxtjs`, `sveltekit`, `gatsby`, `create-react-app`. If unsure, go static (`framework: null`) — agent-generated single-page sites almost never need a build step.

## Team / scope

If the org has multiple Vercel teams, the deploy goes to the user's default team. To target a specific team, add `teamId: "team_..."` or `slug: "<team-slug>"`. If you don't have one and the API errors with team scope, **ask the user once** — don't guess.

## After deploy

The response contains:
- `id` (deployment id)
- `url` (preview URL — `<project>-<hash>.vercel.app`)
- `readyState` (`READY` after build completes)

Return the URL to the user immediately. The build is usually <30s for static; longer for framework projects. Don't poll endlessly — share the URL and tell the user "live in ~30 seconds."

## Common errors and fixes

- **`missing_project_settings`** → you forgot `skipAutoDetectionConfirmation: "1"` OR `projectSettings.framework`. Add one and retry.
- **`Not authorized`** / 401 → token expired or wrong scopes. Tell the user to reconnect Vercel at `/integrations`.
- **`forbidden`** / 403 → the auth token doesn't have access to that team. Either drop `teamId`/`slug`, or ask which team they want.
- **`name_invalid`** → project name has spaces or uppercase. Slugify: lowercase, hyphens only.

## Don't

- Don't write the file to `workspace/outbox/` and tell the user to deploy manually if Vercel is connected. Call the tool. If it fails, surface the real error and one specific recovery — don't ask the user to do it themselves unless three retries with corrected params still fail.
- Don't ask the user for their team slug before trying — try without `teamId` first, only ask if the API specifically rejects with a scope error.
