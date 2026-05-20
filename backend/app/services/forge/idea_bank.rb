module Forge
  # The 100-template factory's input list. Combines RoleBriefs (20 curated
  # briefs with rich notes) with EXTRA (80 lighter briefs the generator can
  # expand from name+role+category+description alone). Together with the
  # 16 hand-written seeds in db/seeds/agent_templates.rb, the system can
  # ship ~116 templates after `rake forge:bootstrap` finishes.
  #
  # Adding more: drop new entries into EXTRA. No registry to keep in sync —
  # Bootstrap reads ALL on each run and upserts on slug.
  module IdeaBank
    EXTRA = [
      # ── starter (broaden the entry point) ────────────────────────────
      { slug: "personal-assistant", name: "Personal Assistant", role: "Personal Assistant", category: "personal", description: "General-purpose assistant for inbox, calendar, errands, and personal admin." },
      { slug: "travel-planner",     name: "Travel Planner",     role: "Travel Planner",     category: "personal", description: "Books flights/hotels, builds itineraries, monitors prices, handles changes." },
      { slug: "fitness-coach",      name: "Fitness Coach",      role: "Fitness Coach",      category: "personal", description: "Plans workouts, tracks progress, adjusts to recovery + goals." },
      { slug: "nutrition-coach",    name: "Nutrition Coach",    role: "Nutrition Coach",    category: "personal", description: "Meal plans, macros tracking, grocery lists tailored to dietary goals." },
      { slug: "language-tutor",     name: "Language Tutor",     role: "Language Tutor",     category: "personal", description: "Daily lessons, drills, conversation practice in any target language." },
      { slug: "writing-coach",      name: "Writing Coach",      role: "Writing Coach",      category: "personal", description: "Reviews drafts, gives line edits, holds the writer accountable to a cadence." },
      { slug: "study-buddy",        name: "Study Buddy",        role: "Study Buddy",        category: "personal", description: "Quizzes, flashcards, spaced repetition for any subject the user is studying." },
      { slug: "journal-reflection", name: "Journal & Reflection", role: "Reflection Coach", category: "personal", description: "Daily journaling prompts, weekly review, surfaces patterns over time." },

      # ── sales (close the gap) ─────────────────────────────────────────
      { slug: "bdr",                 name: "Business Development Rep", role: "BDR",          category: "sales", description: "Outbound prospecting into enterprise accounts — multi-touch sequences." },
      { slug: "enterprise-ae",       name: "Enterprise AE",            role: "Enterprise AE", category: "sales", description: "Closer for 6-figure+ deals — runs MEDDIC, multi-thread, exec sponsor." },
      { slug: "deal-desk",           name: "Deal Desk",                role: "Deal Desk",    category: "sales", description: "Pricing approvals, contract redlines, non-standard terms review." },
      { slug: "rev-ops",             name: "Revenue Operations",       role: "RevOps",       category: "sales", description: "Pipeline hygiene, forecast accuracy, comp plan modeling, tooling." },
      { slug: "channel-partner",     name: "Channel & Partnerships",   role: "Partnerships", category: "sales", description: "Reseller programs, integration partners, co-marketing." },
      { slug: "sales-trainer",       name: "Sales Trainer",            role: "Sales Trainer", category: "sales", description: "Onboards new reps, runs roleplays, scores call recordings, builds playbooks." },
      { slug: "sales-development-mgr", name: "SDR Manager",            role: "SDR Manager",  category: "sales", description: "Manages the SDR team — pipeline targets, coaching, hiring." },
      { slug: "account-manager",     name: "Account Manager",          role: "Account Manager", category: "sales", description: "Post-sale relationship — renewals, expansion, executive QBRs." },
      { slug: "outbound-copywriter", name: "Outbound Copywriter",      role: "Sales Copywriter", category: "sales", description: "Drafts cold emails, LinkedIn DMs, sequence variants. A/B-tests subject lines." },
      { slug: "lead-qualifier",      name: "Lead Qualifier",           role: "Lead Qualifier", category: "sales", description: "First-touch on inbound leads — BANT/ICP fit check, routes to right rep." },

      # ── support / CX ──────────────────────────────────────────────────
      { slug: "tier-1-support",      name: "Tier 1 Support",     role: "Tier 1 Support",   category: "support", description: "First-line for common tickets — password resets, billing questions, FAQ." },
      { slug: "tier-2-support",      name: "Tier 2 Support",     role: "Tier 2 Support",   category: "support", description: "Technical issues escalated from Tier 1 — log analysis, reproducing bugs." },
      { slug: "support-engineer",    name: "Support Engineer",   role: "Support Engineer", category: "support", description: "Deep technical support — API integrations, customer code debugging, RCA." },
      { slug: "knowledge-curator",   name: "Knowledge Curator",  role: "KB Curator",       category: "support", description: "Maintains help center articles, kills duplicates, gap-analyzes ticket trends." },
      { slug: "escalation-manager",  name: "Escalation Manager", role: "Escalation Manager", category: "support", description: "Owns high-severity / VIP customer issues end-to-end." },
      { slug: "onboarding-specialist", name: "Customer Onboarding", role: "Onboarding Specialist", category: "support", description: "Drives new customers from contract signed to first value within 30 days." },
      { slug: "training-specialist", name: "Customer Training",  role: "Trainer",          category: "support", description: "Runs live + recorded product training for customer admins and end-users." },

      # ── marketing ────────────────────────────────────────────────────
      { slug: "lifecycle-marketer",  name: "Lifecycle Marketer",  role: "Lifecycle Marketing", category: "marketing", description: "Owns email/SMS lifecycle — onboarding, retention, win-back, transactional." },
      { slug: "email-marketer",      name: "Email Marketer",      role: "Email Marketing", category: "marketing", description: "Newsletter, drip campaigns, audience segmentation, deliverability." },
      { slug: "paid-ads-specialist", name: "Paid Ads Specialist", role: "Paid Ads",        category: "marketing", description: "Meta/Google/LinkedIn ad campaigns — creative briefs, bid management, attribution." },
      { slug: "podcast-producer",    name: "Podcast Producer",    role: "Podcast Producer", category: "marketing", description: "Books guests, edits episodes, drafts show notes, distributes." },
      { slug: "webinar-producer",    name: "Webinar Producer",    role: "Webinar Producer", category: "marketing", description: "Plans webinars — speakers, slides, registration, follow-up." },
      { slug: "events-manager",      name: "Events Manager",      role: "Events Manager",  category: "marketing", description: "Conferences, dinners, field events — venue, logistics, attendee list, ROI." },
      { slug: "influencer-manager",  name: "Influencer Manager",  role: "Influencer Lead", category: "marketing", description: "Sources creators, briefs campaigns, tracks deliverables + performance." },
      { slug: "youtube-producer",    name: "YouTube Producer",    role: "YouTube Producer", category: "marketing", description: "Long-form video pipeline — research, script, thumbnail, upload, optimize." },
      { slug: "newsletter-editor",   name: "Newsletter Editor",   role: "Newsletter Editor", category: "marketing", description: "Weekly newsletter — sourcing, curation, writing, performance review." },
      { slug: "case-study-writer",   name: "Case Study Writer",   role: "Case Study Writer", category: "marketing", description: "Interviews customers, drafts case studies, publishes assets across channels." },
      { slug: "content-strategist",  name: "Content Strategist",  role: "Content Strategist", category: "marketing", description: "Editorial calendar, topic clusters, brief writers, measure content ROI." },

      # ── engineering ───────────────────────────────────────────────────
      { slug: "frontend-engineer",   name: "Frontend Engineer",   role: "Frontend Engineer", category: "engineering", description: "React/Vue/Svelte features, accessibility, performance, design-system fidelity." },
      { slug: "backend-engineer",    name: "Backend Engineer",    role: "Backend Engineer", category: "engineering", description: "API design, database modeling, background jobs, integrations." },
      { slug: "mobile-engineer",     name: "Mobile Engineer",     role: "Mobile Engineer", category: "engineering", description: "iOS/Android features, store submissions, crash analytics, OTA updates." },
      { slug: "ml-engineer",         name: "ML Engineer",         role: "ML Engineer",     category: "engineering", description: "Model training, evaluation, deployment, monitoring drift." },
      { slug: "security-engineer",   name: "Security Engineer",   role: "Security Engineer", category: "engineering", description: "Vulnerability triage, dependency audits, secrets scanning, incident response." },
      { slug: "platform-engineer",   name: "Platform Engineer",   role: "Platform Engineer", category: "engineering", description: "Internal developer platform — CI/CD, dev environments, observability." },
      { slug: "tech-writer",         name: "Technical Writer",    role: "Technical Writer", category: "engineering", description: "API docs, integration guides, release notes, internal architecture docs." },

      # ── ops + finance + people ────────────────────────────────────────
      { slug: "controller",          name: "Controller",          role: "Controller",       category: "ops", description: "GAAP-clean books, monthly close, audit prep, board-grade financials." },
      { slug: "fp-and-a",            name: "FP&A Analyst",        role: "FP&A",             category: "ops", description: "Forecasting, variance analysis, scenario modeling, board pack assembly." },
      { slug: "payroll-specialist",  name: "Payroll Specialist",  role: "Payroll",          category: "ops", description: "Bi-weekly payroll runs, contractor 1099s, state tax registrations." },
      { slug: "ap-clerk",            name: "AP Clerk",            role: "Accounts Payable", category: "ops", description: "Vendor invoices intake, approval routing, payment scheduling." },
      { slug: "ar-collections",      name: "AR / Collections",    role: "AR",               category: "ops", description: "Send invoices, chase overdue accounts, escalate to legal cutoff." },
      { slug: "procurement",         name: "Procurement",         role: "Procurement",      category: "ops", description: "Vendor selection, contract negotiation, PO issuance, savings tracking." },
      { slug: "it-helpdesk",         name: "IT Helpdesk",         role: "IT Helpdesk",      category: "ops", description: "Laptops, accounts, SSO, MDM, software requests, offboarding." },
      { slug: "supply-chain",        name: "Supply Chain Coord",  role: "Supply Chain",     category: "ops", description: "Manufacturing schedule, inventory levels, shipping, supplier QA." },
      { slug: "facilities-manager",  name: "Facilities Manager",  role: "Facilities",       category: "ops", description: "Office space, vendors, snacks, cleaning, mail." },
      { slug: "compliance-monitor",  name: "Compliance Monitor",  role: "Compliance",       category: "ops", description: "Tracks SOC 2 / HIPAA / GDPR evidence, runs quarterly access reviews." },

      { slug: "talent-sourcer",      name: "Talent Sourcer",      role: "Talent Sourcer",   category: "people", description: "Builds candidate pipelines on LinkedIn, GitHub, AngelList for open roles." },
      { slug: "interview-scheduler", name: "Interview Scheduler", role: "Interview Coordinator", category: "people", description: "Books candidate panels across timezones, sends prep, collects feedback." },
      { slug: "comp-analyst",        name: "Compensation Analyst", role: "Comp Analyst",     category: "people", description: "Salary bands, equity refresh modeling, market benchmarking." },
      { slug: "employer-brand",      name: "Employer Brand",      role: "Employer Brand",   category: "people", description: "Glassdoor responses, careers page, employee stories, recruiting marketing." },

      # ── industry-specific (high-leverage verticals) ───────────────────
      { slug: "real-estate-agent",   name: "Real Estate Agent Assistant", role: "Real Estate Assistant", category: "ops", description: "Listings, showings, MLS updates, buyer/seller follow-up, paperwork." },
      { slug: "real-estate-leasing", name: "Leasing Agent",       role: "Leasing Agent",    category: "ops", description: "Inbound lead triage, tours scheduling, application screening, lease drafting." },
      { slug: "medical-scribe",      name: "Medical Scribe",      role: "Medical Scribe",   category: "ops", description: "Listens to encounters, drafts SOAP notes, codes ICD/CPT for physician sign-off." },
      { slug: "dental-front-desk",   name: "Dental Front Desk",   role: "Dental Front Desk", category: "ops", description: "Patient scheduling, insurance verification, reminders, no-show recovery." },
      { slug: "veterinary-receptionist", name: "Vet Receptionist", role: "Vet Front Desk",   category: "ops", description: "Pet appointment booking, vaccine reminders, intake forms, follow-up." },
      { slug: "law-firm-intake",     name: "Law Firm Intake",     role: "Law Intake",       category: "ops", description: "Screens potential clients, conflict checks, runs intake interview, books consult." },
      { slug: "paralegal",           name: "Paralegal",           role: "Paralegal",        category: "ops", description: "Drafts pleadings, discovery, citation checking, deposition prep." },
      { slug: "insurance-broker",    name: "Insurance Broker Assistant", role: "Insurance Broker", category: "ops", description: "Quote comparison, application prep, renewal management, claims liaison." },
      { slug: "restaurant-manager",  name: "Restaurant Manager",  role: "Restaurant Manager", category: "ops", description: "Reservations, supplier orders, staff scheduling, reviews response, POS reports." },
      { slug: "fitness-studio-manager", name: "Fitness Studio Manager", role: "Studio Manager", category: "ops", description: "Class scheduling, instructor coordination, member retention, MindBody admin." },
      { slug: "ecommerce-operator",  name: "Ecommerce Operator",  role: "Ecom Operator",    category: "ops", description: "Daily orders, refund decisions, customer service, ad rotation, inventory." },
      { slug: "etsy-shop",           name: "Etsy Shop Assistant", role: "Etsy Shop",        category: "ops", description: "Listings SEO, customer messages, fulfillment, review responses, ad budget." },
      { slug: "tutoring-business",   name: "Tutoring Coordinator", role: "Tutor Coordinator", category: "ops", description: "Matches students to tutors, runs scheduling, tracks progress, parent comms." },
      { slug: "freelance-ops",       name: "Freelancer Ops",      role: "Solo Ops",         category: "ops", description: "Solo founder/freelancer end-to-end — proposals, contracts, invoices, taxes." },
      { slug: "nonprofit-fundraising", name: "Nonprofit Fundraising", role: "Fundraising",   category: "ops", description: "Donor research, grant applications, event coordination, gift acknowledgments." },

      # ── personal/lifestyle (consumer-y) ───────────────────────────────
      { slug: "wedding-planner",     name: "Wedding Planner",     role: "Wedding Planner",  category: "personal", description: "Vendor coordination, timeline, RSVP tracking, day-of run-of-show." },
      { slug: "home-renovation",     name: "Home Renovation PM",  role: "Renovation PM",    category: "personal", description: "Contractor coordination, permits, inspections, budget tracking." },
      { slug: "pet-care",            name: "Pet Care Coordinator", role: "Pet Care",         category: "personal", description: "Vet appointments, medication schedules, walker bookings, feeding plans." },
      { slug: "household-manager",   name: "Household Manager",   role: "Household Manager", category: "personal", description: "Cleaners, repairs, groceries, kid logistics — keeps the house running." },
      { slug: "side-hustle-coach",   name: "Side Hustle Coach",   role: "Side Hustle Coach", category: "personal", description: "Holds the user accountable on a side project — weekly check-ins, blockers, output review." },

      # ── creative / media ──────────────────────────────────────────────
      { slug: "ux-researcher",       name: "UX Researcher",       role: "UX Researcher",    category: "engineering", description: "User interviews, usability studies, survey design, insight synthesis." },
      { slug: "product-designer",    name: "Product Designer",    role: "Product Designer", category: "engineering", description: "Wireframes, prototypes, design-spec handoff, usability iteration." },
      { slug: "motion-designer",     name: "Motion Designer",     role: "Motion Designer",  category: "marketing", description: "After-Effects-style motion work — explainer animations, UI motion, intros." },
      { slug: "copy-editor",         name: "Copy Editor",         role: "Copy Editor",      category: "marketing", description: "Proofreads marketing + product copy, style-guide enforcement, fact-checks." },
      { slug: "translator",          name: "Translator / Localizer", role: "Translator",   category: "marketing", description: "Marketing + product translation across target languages, glossary management." },

      # ── data / analytics ──────────────────────────────────────────────
      { slug: "analytics-engineer",  name: "Analytics Engineer",  role: "Analytics Engineer", category: "engineering", description: "dbt models, semantic layer, metrics definitions, dashboard build." },
      { slug: "data-scientist",      name: "Data Scientist",      role: "Data Scientist",   category: "engineering", description: "Hypothesis testing, model prototyping, statistical analyses, stakeholder readouts." },
      { slug: "bi-analyst",          name: "BI Analyst",          role: "BI Analyst",       category: "ops", description: "Stakeholder dashboards, ad-hoc data pulls, KPI weekly reports." },

      # ── misc that round out coverage ──────────────────────────────────
      { slug: "social-listener",     name: "Social Listener",     role: "Social Listener",  category: "marketing", description: "Monitors brand mentions, sentiment, competitor activity, trending topics." },
      { slug: "review-responder",    name: "Review Responder",    role: "Review Responder", category: "marketing", description: "Replies to Google/Yelp/App Store reviews in brand voice. Flags real issues." },
      { slug: "affiliate-manager",   name: "Affiliate Manager",   role: "Affiliate Manager", category: "marketing", description: "Recruits affiliates, tracks performance, handles payouts, fraud watch." },
      { slug: "trademark-watch",     name: "Trademark Watch",     role: "IP Watch",         category: "ops", description: "Monitors USPTO + global IP for conflicts with the brand. Drafts cease-and-desist." },
    ].freeze

    ALL = (RoleBriefs::ALL + EXTRA).uniq { |b| b[:slug] }
  end
end
