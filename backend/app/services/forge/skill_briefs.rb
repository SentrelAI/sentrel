module Forge
  # Curated skill briefs that feed SkillGenerator. Skills are agent
  # capabilities — when to use, when not, auth, endpoints, workflow, errors.
  # Fill gaps in the existing 18 skill seeds.
  module SkillBriefs
    BATCH_1 = [
      {
        slug: "vertical-video-design",
        name: "Vertical Video Design",
        category: "content",
        description: "Design rules and patterns for 9:16 portrait video (IG Reels, TikTok, Shorts).",
        notes: "Hard rules: full-bleed b-roll always, type 180-320px hero / 80-120px sub / 48-72px body, safe zones (TikTok UI top 240px / bottom 280px), never pure black backgrounds, 8 portrait-native patterns with code (kinetic stack, big-image-tiny-caption, split-screen, text-on-photo full-bleed, kinetic typography slam, ticker, swipe-stack, photo-flicker). Motion grammar: vertical swipes, scale-from-zero, glitch beats. Reference step: fetch 3 brand reference reels before designing.",
        requires_connections: [],
      },
      {
        slug: "veo-prompting",
        name: "Veo Prompting",
        category: "content",
        description: "Write Veo prompts that produce cinematic, photoreal video. Vertical/landscape templates.",
        notes: "Required prompt elements: subject, camera angle, lens (35mm/50mm/85mm), DoF, lighting (golden hour / overcast / interior key+fill), color palette, motion, duration. For 9:16 add 'shot vertically for mobile, subject fills frame'. Style presets: cinematic, editorial, lifestyle, clinical, kinetic. Anti-patterns: text in image, logos, watermarks, 'AI-generated look'. Cost ~$0.30-0.50 per 8-second clip. Use Veo 3 via Gemini API.",
        endpoints: "POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:generateContent",
        requires_connections: [],
      },
      {
        slug: "image-generation",
        name: "Image Generation",
        category: "content",
        description: "Generate brand-aligned images via Imagen/Flux/DALL-E with consistent style.",
        notes: "Default to Imagen 3 via Gemini API. Falls back to OpenAI DALL-E 3 if Gemini is rate-limited. Prompt structure: subject + style + composition + lighting + color. Save outputs to workspace and use share_file to publish. Aspect ratios: 1:1 (social square), 9:16 (story), 16:9 (web hero), 4:5 (IG portrait feed).",
        endpoints: "POST https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent",
        requires_connections: [],
      },
      {
        slug: "transcription",
        name: "Transcription",
        category: "productivity",
        description: "Transcribe audio/video to text with timestamps via Whisper or AssemblyAI.",
        notes: "For files in /data/workspace: use bun's bundled whisper-cli when available; else POST to AssemblyAI. Output: SRT (for captions), VTT (web), or plain text. For long files, chunk and stitch. Include word-level timestamps for caption animations.",
        endpoints: "POST https://api.assemblyai.com/v2/transcript",
        requires_connections: [],
      },
      {
        slug: "linkedin-prospecting",
        name: "LinkedIn Prospecting",
        category: "sales",
        description: "Find decision-makers on LinkedIn via Apollo/PhantomBuster, enrich with email.",
        notes: "Apollo for ICP search by title/industry/headcount. PhantomBuster for profile scraping. Hunter.io for email verification. Always respect connection limits (max 100 invites/week). Pair with sdr-outreach for cadence. Output: CSV with name, title, company, email, LinkedIn URL, confidence score.",
        requires_connections: %w[apollo],
      },
      {
        slug: "salesforce-crm",
        name: "Salesforce CRM",
        category: "sales",
        description: "Read/write Salesforce — leads, contacts, accounts, opportunities, activities.",
        notes: "Via Composio. Query SOQL for reporting, create/update objects for write-back. Common patterns: log call activity, advance opportunity stage, create task from meeting notes. Respect field-level security — wrap writes in try/catch.",
        requires_connections: %w[salesforce],
      },
      {
        slug: "notion-database",
        name: "Notion Database",
        category: "productivity",
        description: "CRUD on Notion databases — pages, properties, relations, queries.",
        notes: "Via Composio. Patterns: query by filter (status=Active), create page in DB, update properties, add relations. For knowledge-base use, prefer storing structured data in Notion DB vs free-form pages. Pagination — Notion returns 100/page, loop until has_more=false.",
        requires_connections: %w[notion],
      },
      {
        slug: "meeting-summary",
        name: "Meeting Summary",
        category: "productivity",
        description: "Process meeting transcripts into structured notes: TL;DR, decisions, action items, follow-ups.",
        notes: "Input: raw transcript text or Granola/Otter/Fireflies export. Output sections: TL;DR (3 bullets), Attendees, Decisions (bulleted), Action Items (owner / item / due-date), Open Questions, Follow-up Drafts (email replies to send). Auto-create tasks for action items via create_task. Pair with calendar-booking for follow-up scheduling.",
        requires_connections: [],
      },
      {
        slug: "pdf-generation",
        name: "PDF Generation",
        category: "content",
        description: "Render HTML/markdown to PDF — proposals, reports, invoices, contracts.",
        notes: "Use puppeteer headless Chrome (already bundled in engine). Workflow: write HTML template with print CSS (@page size, margins, page-break), inject content, render to PDF, share_file to publish URL. For invoices/contracts: include letterhead, page numbers, signature blocks. Avoid Word/.docx output — PDFs are universal.",
        requires_connections: [],
      },
      {
        slug: "competitive-research",
        name: "Competitive Research",
        category: "common",
        description: "Build a competitor profile: features, pricing, positioning, hiring signals, recent moves.",
        notes: "Workflow: (1) Identify N competitors from web search. (2) For each: scrape homepage + /pricing + /about. (3) Pull funding history (Crunchbase via search). (4) Check job postings (signals what they're building). (5) Pull recent press. (6) Output a one-pager per competitor + a side-by-side matrix. Cache results in knowledge_base for re-use.",
        requires_connections: [],
      },
    ].freeze

    BATCH_2 = [
      { slug: "voice-call", name: "Voice Calls (Twilio/Vapi)", category: "communication", description: "Make and receive phone calls — outbound dial, IVR, voicemail, call recording transcripts.", notes: "Vapi.ai for AI-handled calls (agent talks). Twilio Programmable Voice for raw call control. Always disclose recording at start of call. Output transcript stored in knowledge_base.", requires_connections: %w[twilio vapi] },
      { slug: "stripe-billing", name: "Stripe Billing", category: "finance", description: "Customers, subscriptions, invoices, refunds, dispute handling via Stripe API.", notes: "Composio. Read-heavy by default — writes (refund, void) gated on request_approval. Common: lookup customer by email, list outstanding invoices, advance subscription, issue refund <$50 auto / >$50 approval.", requires_connections: %w[stripe] },
      { slug: "airtable-database", name: "Airtable Database", category: "productivity", description: "CRUD on Airtable bases — records, views, attachments.", notes: "Via Composio. Filter by formula, sort, paginate. For attachments, upload via blob then attach URL. Avoid mass deletes — Airtable doesn't have soft-delete.", requires_connections: %w[airtable] },
      { slug: "google-drive-files", name: "Google Drive Files", category: "productivity", description: "Search, read, create, share Drive files. Convert Docs/Sheets to PDF/markdown.", notes: "Composio. Search by name/owner/modifiedTime. Read Google Docs as markdown via export. Share with role (reader/writer) and audience (email or 'anyone with link'). Watch quota.", requires_connections: %w[google-drive] },
      { slug: "shopify-store", name: "Shopify Store Ops", category: "ops", description: "Orders, products, inventory, customers, fulfillments.", notes: "Composio. Common: pull today's orders, flag low stock, mark fulfilled, draft customer responses for support tickets via Shopify customer notes.", requires_connections: %w[shopify] },
      { slug: "hubspot-deep", name: "HubSpot CRM Deep", category: "sales", description: "Beyond basic CRM — workflows, sequences, custom properties, deal-stage automation.", notes: "Extends the existing hubspot-crm seed. Adds sequence management, workflow triggers, custom property reads/writes, association object linking.", requires_connections: %w[hubspot] },
      { slug: "github-engineering", name: "GitHub Engineering", category: "engineering", description: "Issues, PRs, releases, actions runs, code search across a repo.", notes: "Composio + gh CLI fallback. Common: triage new issue → label + assign + draft response; review PR diff and post comments; cut a release with changelog; check failed CI runs.", requires_connections: %w[github] },
      { slug: "calendly-scheduling", name: "Calendly Scheduling", category: "productivity", description: "Read availability, create one-off booking links, route by team round-robin.", notes: "Pair with calendar-booking (existing). Generates single-use links for high-intent leads, parses confirmations into CRM activity.", requires_connections: %w[calendly] },
      { slug: "google-sheets", name: "Google Sheets", category: "productivity", description: "Read/write/format Sheets — for reports, trackers, lightweight DBs.", notes: "Composio. Patterns: append row to log, read range as table, format conditional colors, freeze headers. For analyst handoffs: write a tab + share link.", requires_connections: %w[google-sheets] },
      { slug: "loom-recording", name: "Loom Recording Notes", category: "communication", description: "Pull Loom video transcripts, summarize, generate follow-up notes.", notes: "Watch a folder of Loom URLs. Transcribe via Loom API. Output summary + action items. Pair with meeting-summary skill.", requires_connections: %w[loom] },
    ].freeze

    ALL = BATCH_1 + BATCH_2
  end
end
