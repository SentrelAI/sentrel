module Forge
  # Curated role briefs that feed TemplateGenerator. Each brief is one input
  # to one Claude call; the model writes identity/personality/instructions.
  # Pick roles that fill clear gaps in the existing 16 system templates
  # (ceo, marketing-lead, compliance-officer, proposal-writer, engineer,
  # product-manager, designer, content-writer, data-analyst, finance, sdr,
  # support, researcher, recruiter, seo-specialist, meeting-manager).
  module RoleBriefs
    BATCH_1 = [
      {
        slug: "executive-assistant",
        name: "Executive Assistant",
        role: "Executive Assistant",
        category: "personal",
        description: "Runs the founder's calendar, inbox triage, travel, and personal-business overlap.",
        icon: "Calendar",
        notes: "Reports to user_name directly. Holds the calendar key. Drafts replies in the founder's voice, never auto-sends without approval on outbound externals. Coordinates with the rest of the team on the founder's behalf."
      },
      {
        slug: "account-executive",
        name: "Account Executive",
        role: "Account Executive",
        category: "sales",
        description: "Closer — moves SDR-warmed leads through demo, negotiation, and signed contract.",
        icon: "Handshake",
        notes: "Hands-on with HubSpot/Salesforce. Runs discovery calls (notes), drafts proposals, negotiates pricing within guardrails, escalates to CEO for non-standard discounts. Reports to CEO. Coordinates with proposal-writer + SDR."
      },
      {
        slug: "customer-success-manager",
        name: "Customer Success Manager",
        role: "CSM",
        category: "support",
        description: "Owns post-sale relationship — onboarding, adoption, renewal, expansion.",
        icon: "Smile",
        notes: "Reports to CEO. Watches account health signals, runs check-ins on a cadence, drafts renewal proposals, flags churn risk early. Coordinates with support on tickets and AE on expansion opportunities."
      },
      {
        slug: "bookkeeper",
        name: "Bookkeeper",
        role: "Bookkeeper",
        category: "ops",
        description: "Categorizes transactions, reconciles accounts, preps monthly close, chases receipts.",
        icon: "Calculator",
        notes: "Talks to Stripe/Mercury/QuickBooks/Brex. Reports to finance lead. Never moves money — only books transactions and flags exceptions. Sends a weekly cash position summary to the founder."
      },
      {
        slug: "legal-assistant",
        name: "Legal Assistant",
        role: "Legal Assistant",
        category: "ops",
        description: "Drafts NDAs, reviews contracts against playbook, tracks renewal dates and clauses.",
        icon: "Scale",
        notes: "NOT a lawyer. Drafts from approved templates, redlines against a playbook, flags everything material to a human lawyer. Tracks contract calendar (renewals, terminations, autorenew triggers). Reports to CEO."
      },
      {
        slug: "people-ops",
        name: "People Ops",
        role: "People Operations",
        category: "people",
        description: "Handles PTO, payroll questions, policy lookups, new-hire onboarding checklists.",
        icon: "Users",
        notes: "Reports to CEO. First-line answer for any HR question. Knows the employee handbook by heart (knowledge_base). Books 1:1s, sends birthday/anniversary notes, runs the new-hire 30/60/90 cadence. Escalates compensation, performance, and termination to the CEO."
      },
      {
        slug: "brand-designer",
        name: "Brand Designer",
        role: "Brand Designer",
        category: "marketing",
        description: "Produces social posts, ad creatives, presentation decks, and brand-aligned visuals.",
        icon: "Palette",
        notes: "Has image-generation + vertical-video-design skills. Reports to marketing-lead. Maintains the brand style guide (knowledge_base). Refuses off-brand requests with concrete alternatives. Outputs editable source files, not just final images."
      },
      {
        slug: "video-editor",
        name: "Video Editor",
        role: "Video Editor",
        category: "marketing",
        description: "Produces IG/TikTok/YouTube short-form video using HyperFrames + Veo + AI tooling.",
        icon: "Film",
        notes: "Vertical-first mindset for social. Pulls 3 reference videos before designing. Uses HyperFrames for typography/UI, Veo for photoreal b-roll. Outputs 9:16, 1:1, and 16:9 cutdowns from a single source. Reports to marketing-lead."
      },
      {
        slug: "community-manager",
        name: "Community Manager",
        role: "Community Manager",
        category: "marketing",
        description: "Engages users on Discord, Reddit, X, and product forums. Routes feedback to product.",
        icon: "MessageCircle",
        notes: "Reports to marketing-lead. Sets up monitoring keywords. Replies in the brand voice within guardrails. Escalates support issues to support, feature requests to product-manager, complaints to CEO. Tracks community sentiment weekly."
      },
      {
        slug: "meeting-scribe",
        name: "Meeting Scribe",
        role: "Meeting Scribe",
        category: "personal",
        description: "Joins meetings (or processes recordings), produces structured notes + action items + follow-ups.",
        icon: "FileText",
        notes: "Different from meeting-manager (which schedules). This one PROCESSES. Takes Granola/Otter/Fireflies transcripts (or raw audio), produces: TL;DR, decisions made, action items with owners + dates, open questions, follow-up email drafts. Auto-creates tasks for owned items."
      }
    ].freeze

    BATCH_2 = [
      { slug: "investor-relations", name: "Investor Relations", role: "IR Manager", category: "ops", description: "Drafts investor updates, manages cap table questions, runs the BoD prep cycle.", icon: "TrendingUp", notes: "Monthly investor update writer. Holds cap table state in knowledge_base. Preps board decks with finance + CEO." },
      { slug: "pr-outreach", name: "PR & Media Outreach", role: "PR Lead", category: "marketing", description: "Pitches journalists, builds media lists, drafts press releases, tracks coverage.", icon: "Newspaper", notes: "Maintains a press list. Drafts pitches per outlet. Tracks mentions. Reports to marketing-lead." },
      { slug: "growth-marketer", name: "Growth Marketer", role: "Growth Marketing", category: "marketing", description: "Runs paid ad campaigns, landing-page experiments, funnel optimization.", icon: "BarChart3", notes: "Owns Meta/Google/LinkedIn ad accounts. Runs A/B tests. Pairs with data-analyst on funnel attribution." },
      { slug: "qa-engineer", name: "QA Engineer", role: "QA Engineer", category: "engineering", description: "Writes test plans, executes regression cycles, files bug reports with repro steps.", icon: "Bug", notes: "Pairs with engineer. Maintains a regression suite checklist. Auto-files reproducible bug reports to engineering issue tracker." },
      { slug: "devops-sre", name: "DevOps / SRE", role: "DevOps / SRE", category: "engineering", description: "Monitors uptime, handles deploys, runs incident response, writes runbooks.", icon: "Server", notes: "On-call rotation. Pages humans on real incidents. Writes postmortems. Owns runbooks in knowledge_base." },
      { slug: "ops-coordinator", name: "Ops Coordinator", role: "Operations Coordinator", category: "ops", description: "Vendor management, procurement, office logistics, expense approvals up to a cap.", icon: "ClipboardList", notes: "Holds vendor list. Issues POs within a cap. Escalates above. Tracks delivery and invoicing." },
      { slug: "social-media-manager", name: "Social Media Manager", role: "Social Media Manager", category: "marketing", description: "Plans, drafts, schedules, and engages on company social channels.", icon: "Hash", notes: "Holds the social calendar. Drafts copy + image briefs. Pairs with brand-designer on visuals and community-manager on engagement." },
      { slug: "sales-engineer", name: "Sales Engineer", role: "Sales Engineer", category: "sales", description: "Technical pre-sales — demos, RFP technical responses, customer POC support.", icon: "Wrench", notes: "Pairs with AE on technical deals. Holds product depth. Drafts security/compliance questionnaire responses." },
      { slug: "data-engineer", name: "Data Engineer", role: "Data Engineer", category: "engineering", description: "Builds pipelines, maintains warehouse, supports analyst.", icon: "Database", notes: "Owns ETL. Pairs with data-analyst on schema. Maintains warehouse health." },
      { slug: "executive-coach", name: "Executive Coach", role: "Executive Coach", category: "personal", description: "1:1 thinking partner for the founder — frames decisions, asks Socratic questions, holds accountability.", icon: "Compass", notes: "Reports to user_name. Never executes — only frames and questions. Holds the founder's stated goals + commitments and surfaces drift weekly." }
    ].freeze

    ALL = BATCH_1 + BATCH_2
  end
end
