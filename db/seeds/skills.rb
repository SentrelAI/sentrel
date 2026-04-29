# Seed built-in skill definitions from the engine's SKILL.md files.
# Run with: bin/rails runner db/seeds/skills.rb

SKILLS = [
  {
    slug: "send-email",
    name: "Email Outreach",
    description: "Send emails via the outbox system with CC/BCC, attachments, and approval flow",
    category: "common",
    icon: "mail",
    requires_connections: [],
  },
  {
    slug: "send-files",
    name: "Send Files",
    description: "Send images, documents, and files to users via any channel",
    category: "common",
    icon: "paperclip",
    requires_connections: [],
  },
  {
    slug: "stealth-browser",
    name: "Stealth Browser",
    description: "Browse websites, take screenshots, fill forms using the stealth browser",
    category: "common",
    icon: "globe",
    requires_connections: [],
  },
  {
    slug: "web-search",
    name: "Web Research",
    description: "Search the web for information, companies, and market data",
    category: "common",
    icon: "search",
    requires_connections: [],
  },
  {
    slug: "sdr-outreach",
    name: "SDR Outreach",
    description: "Draft personalized cold outreach emails with research and follow-ups",
    category: "sales",
    icon: "send",
    requires_connections: [],
  },
  {
    slug: "sdr-prospecting",
    name: "Prospecting",
    description: "Find and qualify leads using web research and available tools",
    category: "sales",
    icon: "target",
    requires_connections: [],
  },
  {
    slug: "apollo-prospecting",
    name: "Apollo Prospecting",
    description: "Find leads and enrich contacts using Apollo.io",
    category: "sales",
    icon: "users",
    requires_connections: ["apollo"],
  },
  {
    slug: "hubspot-crm",
    name: "HubSpot CRM",
    description: "Manage contacts, deals, and pipeline in HubSpot",
    category: "sales",
    icon: "database",
    requires_connections: ["hubspot"],
  },
  {
    slug: "calendar-booking",
    name: "Calendar Booking",
    description: "Check availability and schedule meetings via Google Calendar",
    category: "productivity",
    icon: "calendar",
    requires_connections: ["google"],
  },
  {
    slug: "social-media",
    name: "Social Media",
    description: "Create and manage social media content across platforms",
    category: "content",
    icon: "share-2",
    requires_connections: [],
  },
  {
    slug: "content-writing",
    name: "Content Writing",
    description: "Write blog posts, newsletters, and marketing copy",
    category: "content",
    icon: "file-text",
    requires_connections: [],
  },
  {
    slug: "code-review",
    name: "Code Review",
    description: "Review pull requests, check for security issues and best practices",
    category: "engineering",
    icon: "code",
    requires_connections: ["github"],
  },
  {
    slug: "vercel-deploy",
    name: "Vercel Deploy",
    description: "Deploy static sites and framework apps to Vercel via VERCEL_CREATE_DEPLOYMENT — handles projectSettings + framework detection correctly",
    category: "engineering",
    icon: "rocket",
    requires_connections: ["vercel"],
  },
  {
    slug: "expense-tracking",
    name: "Expense Tracking",
    description: "Categorize expenses, flag anomalies, generate reports",
    category: "finance",
    icon: "credit-card",
    requires_connections: [],
  },
  {
    slug: "slack-communication",
    name: "Slack Communication",
    description: "Post messages, read channels, and manage Slack conversations",
    category: "communication",
    icon: "message-square",
    requires_connections: ["slack"],
  },
  {
    slug: "gmail-management",
    name: "Gmail Management",
    description: "Read, search, and manage Gmail messages via Google API",
    category: "communication",
    icon: "inbox",
    requires_connections: ["google"],
  },
]

# Read existing SKILL.md files where available
skill_dir = File.expand_path("../../../alchemy_engine/skills", __dir__)

FILE_MAP = {
  "send-email" => "common/send-email/SKILL.md",
  "send-files" => "common/send-files/SKILL.md",
  "stealth-browser" => "common/stealth-browser/SKILL.md",
  "web-search" => "common/web-search/SKILL.md",
  "sdr-outreach" => "sdr/outreach/SKILL.md",
  "sdr-prospecting" => "sdr/prospecting/SKILL.md",
  "social-media" => "content/social-media/SKILL.md",
  "content-writing" => "content/writing/SKILL.md",
  "code-review" => "engineering/code-review/SKILL.md",
  "expense-tracking" => "finance/expenses/SKILL.md",
}

# Inline skill_md content for skills that need it bundled with the Rails image
# (the alchemy_engine repo isn't checked out next to Rails on Kamal-deployed
# containers, so the FILE_MAP path doesn't resolve there).
INLINE_SKILL_MD = {
  "vercel-deploy" => <<~MD,
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
        "framework": "nextjs",
        "buildCommand": null,
        "outputDirectory": null,
        "installCommand": null
      },
      "files": [ ... ]
    }
    ```

    Common framework slugs: `nextjs`, `vite`, `astro`, `remix`, `nuxtjs`, `sveltekit`, `gatsby`, `create-react-app`. If unsure, go static (`framework: null`) — agent-generated single-page sites almost never need a build step.

    ## Team / scope

    If the org has multiple Vercel teams the deploy goes to the user's default team. To target a specific team add `teamId: "team_..."` or `slug: "<team-slug>"`. **Try without `teamId` first** — only ask the user if the API rejects with a scope error.

    ## After deploy

    Response contains `id`, `url` (`<project>-<hash>.vercel.app`), `readyState` (`READY` after build). Return the URL to the user immediately and tell them "live in ~30 seconds."

    ## Common errors and fixes

    - **`missing_project_settings`** → you forgot `skipAutoDetectionConfirmation: "1"` OR `projectSettings.framework`. Add one and retry.
    - **`Not authorized`** / 401 → token expired. Tell the user to reconnect Vercel at `/integrations`.
    - **`forbidden`** / 403 → token lacks access to that team. Drop `teamId`/`slug` or ask which team.
    - **`name_invalid`** → project name has spaces or uppercase. Slugify: lowercase + hyphens only.

    ## Don't

    Don't write the file to `workspace/outbox/` and tell the user to deploy manually if Vercel is connected. Call the tool. Surface real errors with specific recoveries. Only escalate to a manual path after three retries with corrected params.
  MD
}

created = 0
updated = 0

SKILLS.each do |attrs|
  # Inline content wins over file-based to keep prod seeds working when the
  # engine repo isn't co-located with Rails. Falls back to a stub if neither
  # source has content.
  file_path = FILE_MAP[attrs[:slug]]
  skill_md = if INLINE_SKILL_MD.key?(attrs[:slug])
    INLINE_SKILL_MD[attrs[:slug]]
  elsif file_path && File.exist?(File.join(skill_dir, file_path))
    File.read(File.join(skill_dir, file_path))
  else
    "---\nname: #{attrs[:slug]}\ndescription: #{attrs[:description]}\n---\n\n# #{attrs[:name]}\n\n#{attrs[:description]}\n"
  end

  record = SkillDefinition.find_or_initialize_by(slug: attrs[:slug])
  is_new = record.new_record?
  record.assign_attributes(
    name: attrs[:name],
    description: attrs[:description],
    category: attrs[:category],
    icon: attrs[:icon],
    requires_connections: attrs[:requires_connections],
    source: "built_in",
    skill_md: skill_md,
  )
  record.save!

  if is_new
    created += 1
  else
    updated += 1
  end
end

puts "Skills seeded: #{created} created, #{updated} updated (#{SkillDefinition.count} total)"
