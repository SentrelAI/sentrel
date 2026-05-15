class HomeController < ApplicationController
  def index
    render inertia: "home/index"
  end

  # /use-cases — public catalog of 100+ ready-to-hire roles. Data lives in
  # USE_CASES below so it's editable without a deploy of frontend code —
  # the Inertia page reads + renders.
  def use_cases
    render inertia: "use_cases/index", props: { categories: USE_CASES }
  end

  # rubocop:disable Layout/LineLength
  # 100 ready-to-hire agent roles, grouped by team. Each entry: name, role,
  # one-line outcome, top 3 skills, top 3 integrations. Used by the public
  # /use-cases catalog page. Adding/removing a row here is a copy-only PR.
  USE_CASES = [
    {
      name: "Sales",
      blurb: "Top-of-funnel and pipeline motion — outreach, qualification, deal hygiene.",
      tone: "indigo",
      roles: [
        { name: "Sarah", role: "SDR (outbound)", outcome: "Sources leads from Apollo, drafts personalized cold emails, hands warm replies to AEs.", skills: %w[apollo outreach personalization], integrations: %w[apollo gmail hubspot] },
        { name: "Mira",  role: "SDR (inbound)",  outcome: "Triages inbound leads, qualifies fit by ICP, books demos in your calendar.", skills: %w[lead-qualification calendar-booking icp-match], integrations: %w[hubspot google_calendar slack] },
        { name: "Alex",  role: "Account Exec assistant", outcome: "Preps deal one-pagers from CRM data + LinkedIn before every call, logs notes after.", skills: %w[deal-prep call-notes crm-update], integrations: %w[hubspot linkedin gong] },
        { name: "Riley", role: "RevOps analyst", outcome: "Weekly pipeline health report — coverage, stage age, win-rate by source.", skills: %w[pipeline-analysis cohort-cuts forecasting], integrations: %w[hubspot google_sheets slack] },
        { name: "Logan", role: "Outreach copywriter", outcome: "Drafts 5-variant A/B test sequences from a single brief, schedules them in your sender.", skills: %w[copywriting a-b-design tone-match], integrations: %w[apollo gmail mixpanel] },
        { name: "Toby",  role: "Lead enricher", outcome: "Takes a raw list, fills in title / company size / tech stack / LinkedIn.", skills: %w[enrichment dedupe icp-tagging], integrations: %w[clearbit apollo google_sheets] },
        { name: "Cassie", role: "Renewal manager", outcome: "Flags accounts 60d before renewal, drafts the conversation starter, books QBR.", skills: %w[renewal-watch qbr-prep usage-pull], integrations: %w[hubspot stripe slack] },
        { name: "Dane",  role: "Partner BD", outcome: "Researches potential partners, opens with a tailored intro, tracks the relationship.", skills: %w[partner-research intro-writing relationship-tracking], integrations: %w[linkedin gmail notion] }
      ]
    },
    {
      name: "Customer Success & Support",
      blurb: "Reactive + proactive customer touchpoints — tickets, onboarding, health.",
      tone: "indigo",
      roles: [
        { name: "Jamie", role: "Support triage", outcome: "Reads every inbound ticket, tags + routes, drafts replies for easy ones.", skills: %w[ticket-triage reply-draft knowledge-base-lookup], integrations: %w[intercom zendesk slack] },
        { name: "Iris",  role: "Onboarding manager", outcome: "Walks new customers through day-1 setup, schedules check-ins, flags blockers.", skills: %w[onboarding-runbook check-in-scheduling blocker-detection], integrations: %w[intercom hubspot google_calendar] },
        { name: "Bea",   role: "CS health analyst", outcome: "Daily account-health score; alerts when usage drops or NPS dips.", skills: %w[usage-pull churn-scoring alerting], integrations: %w[mixpanel stripe slack] },
        { name: "Marco", role: "Bug-report intake", outcome: "Converts user reports into structured GitHub/Linear issues with steps to repro.", skills: %w[bug-classification repro-write issue-creation], integrations: %w[linear github slack] },
        { name: "Nia",   role: "Voice-of-customer", outcome: "Weekly digest of feature requests + pain points pulled from tickets + calls.", skills: %w[theme-clustering quote-extraction prioritization], integrations: %w[intercom gong notion] },
        { name: "Sam",   role: "Cancellation saver", outcome: "Engages users hitting the cancel flow, offers tailored discount or downgrade.", skills: %w[retention-offer empathy persuasion], integrations: %w[stripe intercom slack] }
      ]
    },
    {
      name: "Operations & Admin",
      blurb: "The work that nobody sees but everyone notices when it stops happening.",
      tone: "cyan",
      roles: [
        { name: "Morgan", role: "Chief of Staff", outcome: "Owns your week — calendar, prep docs, follow-ups, weekly priorities email.", skills: %w[calendar-orchestration prep-doc weekly-review], integrations: %w[google_calendar notion slack] },
        { name: "Quinn",  role: "Inbox triage",   outcome: "Reads your email, flags the 5 that matter, drafts replies for the routine ones.", skills: %w[email-triage reply-draft snooze], integrations: %w[gmail slack] },
        { name: "Eve",    role: "Meeting prep + recap", outcome: "Pre-meeting brief 30min before; post-meeting recap + action items in Notion.", skills: %w[pre-brief recap action-extraction], integrations: %w[google_calendar notion zoom] },
        { name: "Theo",   role: "Travel booker",  outcome: "Books flights + hotels within your budget rules; calendar holds; expense ready.", skills: %w[travel-search policy-check expense-prep], integrations: %w[gmail expensify google_calendar] },
        { name: "Pip",    role: "Vendor manager", outcome: "Tracks contracts + renewals; renegotiates each one before auto-renew hits.", skills: %w[contract-tracking renewal-negotiation savings-report], integrations: %w[notion docusign slack] },
        { name: "Ozzy",   role: "Internal helpdesk", outcome: "Answers 'what's the WiFi password' and 'how do I get a Zoom license' all day.", skills: %w[runbook-lookup access-request escalation], integrations: %w[slack notion google_workspace] },
        { name: "Lia",    role: "Office manager", outcome: "Orders supplies, books off-sites, manages the snack budget — and lets you know.", skills: %w[reorder-tracking event-booking budget-tracking], integrations: %w[gmail amazon-business notion] }
      ]
    },
    {
      name: "Marketing & Content",
      blurb: "Brand voice, content production, distribution. The slow grind made faster.",
      tone: "indigo",
      roles: [
        { name: "Tess",  role: "Content writer",  outcome: "Drafts blog posts from outlines + your brand voice doc. Includes SEO keywords.", skills: %w[long-form-writing seo-keyword-research brand-voice], integrations: %w[ahrefs notion ghost] },
        { name: "Wren",  role: "Social media",    outcome: "Daily posts across LinkedIn + Twitter from your weekly themes. Replies to engagement.", skills: %w[social-draft engagement-reply schedule], integrations: %w[buffer linkedin twitter] },
        { name: "Felix", role: "Newsletter editor", outcome: "Weekly newsletter from this week's product updates + 1 thought-piece. Sends Tuesday 9am.", skills: %w[newsletter-curation thought-leadership send-scheduling], integrations: %w[substack mailchimp notion] },
        { name: "Ava",   role: "SEO researcher",  outcome: "Monthly keyword gap analysis vs. competitors. Suggests posts ranked by traffic/difficulty.", skills: %w[seo-gap-analysis serp-research content-brief], integrations: %w[ahrefs google_search_console notion] },
        { name: "Beck",  role: "Repurposer",      outcome: "One long blog post becomes 8 tweets + 1 LinkedIn carousel + 1 video script.", skills: %w[content-repurpose multi-format hooks], integrations: %w[notion buffer descript] },
        { name: "Hope",  role: "PR outreach",     outcome: "Researches journalists, drafts personalized pitches, follows up after 7 days.", skills: %w[journalist-research pitch-personalization follow-up], integrations: %w[muckrack gmail linkedin] },
        { name: "Indie", role: "Webinar producer", outcome: "Picks topic + co-host based on demand, schedules, builds landing page, sends invites.", skills: %w[topic-validation landing-page invite-sequence], integrations: %w[zoom mailchimp webflow] }
      ]
    },
    {
      name: "Engineering & DevOps",
      blurb: "Engineering velocity, not engineering replacement. Triage + chores + signal-boosting.",
      tone: "cyan",
      roles: [
        { name: "Vex",   role: "PR triage",          outcome: "First-pass review on every PR — formatting, missing tests, obvious bugs. Tags reviewers.", skills: %w[code-review-checklist test-coverage-check reviewer-routing], integrations: %w[github linear slack] },
        { name: "Nox",   role: "Incident manager",   outcome: "Coordinates Sev-1 response — opens channel, pages oncall, drafts status updates, runs RCA.", skills: %w[incident-coordination status-comms rca-draft], integrations: %w[pagerduty slack statuspage] },
        { name: "Plex",  role: "Release notes",      outcome: "Every Friday: 1 paragraph of human-readable changelog from this week's merged PRs.", skills: %w[changelog-write release-summarize translation], integrations: %w[github linear notion] },
        { name: "Sky",   role: "Bug triage",         outcome: "Reads new bugs, dedupes against existing, assigns severity + likely owner.", skills: %w[bug-dedup severity-scoring owner-routing], integrations: %w[linear github sentry] },
        { name: "Tao",   role: "Docs maintainer",    outcome: "Watches for code changes that break docs; opens PR to update with new screenshots.", skills: %w[docs-drift-detection screenshot-update changelog-link], integrations: %w[github notion mintlify] },
        { name: "Hex",   role: "Standup coordinator", outcome: "Async standup in Slack — collects updates, summarizes blockers, surfaces who needs help.", skills: %w[standup-collection blocker-extraction summary], integrations: %w[slack linear notion] },
        { name: "Bolt",  role: "Dependency upgrader", outcome: "Opens Dependabot/Renovate PRs, reads the changelog, writes a one-paragraph 'safe to merge?' note.", skills: %w[dep-changelog-read breaking-change-flag merge-note], integrations: %w[github dependabot slack] },
        { name: "Iggy",  role: "Flaky-test detective", outcome: "Spots tests that fail intermittently in CI, opens an issue with the failure rate + likely cause.", skills: %w[ci-log-parse flake-detection issue-write], integrations: %w[github buildkite linear] },
        { name: "Pyro",  role: "Security scanner",   outcome: "Reads Brakeman / Snyk / dependabot alerts, dedupes, drafts upgrade PRs with risk notes.", skills: %w[cve-triage upgrade-pr risk-assess], integrations: %w[github snyk slack] },
        { name: "Echo.e", role: "Performance watcher", outcome: "Watches p95 latency + error rate; pages when something regresses, writes the first paragraph of the postmortem.", skills: %w[metric-watch regression-detect postmortem-draft], integrations: %w[datadog sentry slack] },
        { name: "Sage.e", role: "API docs writer",   outcome: "When you add a new endpoint or change a request shape, opens a docs PR with examples + curl.", skills: %w[openapi-gen example-write changelog-link], integrations: %w[github mintlify notion] },
        { name: "Cron",  role: "Deploy coordinator", outcome: "Owns the deploy queue — sequences merges, runs migrations, posts go/no-go before each release.", skills: %w[deploy-sequence migration-runner go-no-go], integrations: %w[github kamal slack] },
        { name: "Kit.e", role: "Onboarding eng",     outcome: "When a new engineer joins, posts the day-1 checklist, sets up local env, pairs them with a buddy.", skills: %w[setup-checklist env-validate buddy-pair], integrations: %w[github notion slack] },
        { name: "Rune",  role: "Schema diff alerter", outcome: "Watches db/schema.rb changes; flags risky migrations + suggests staged rollout.", skills: %w[schema-diff risk-flag rollout-plan], integrations: %w[github linear slack] }
      ]
    },

    {
      name: "Creative & Video",
      blurb: "Cut long-form into short. Write the hook. Ship the thumbnail. Repeat 100x.",
      tone: "indigo",
      roles: [
        { name: "Reel",   role: "Clip cutter",         outcome: "Watches the long video, picks the top 5 'hook' moments, exports vertical clips with captions.", skills: %w[transcript-scan hook-detection vertical-export], integrations: %w[descript opus-clip youtube] },
        { name: "Pixel",  role: "Thumbnail designer",  outcome: "Generates 3 thumbnail variants per video, A/B tests on YouTube, picks the winner.", skills: %w[thumbnail-design face-crop ab-test], integrations: %w[figma youtube canva] },
        { name: "Vex.v",  role: "Video script writer", outcome: "Drafts the script for your next long-form from a topic + your channel's voice doc.", skills: %w[hook-write narrative-arc cta-place], integrations: %w[notion google_docs descript] },
        { name: "Lyra",   role: "Subtitle + caption",  outcome: "Generates SRT + burned-in captions in your brand style. Translates to 5 languages.", skills: %w[transcription burn-in translation], integrations: %w[descript otter youtube] },
        { name: "Kit",    role: "Podcast producer",    outcome: "Schedules guests, sends prep docs, edits the raw recording, ships the episode + show notes.", skills: %w[guest-coord prep-doc edit-runbook show-notes], integrations: %w[descript gmail riverside] },
        { name: "Ace",    role: "YouTube SEO",         outcome: "Picks titles + descriptions + tags per video based on what's ranking. Tracks CTR + watch-time.", skills: %w[keyword-research ctr-watch title-test], integrations: %w[youtube vidiq google_search_console] },
        { name: "Boom",   role: "Sound editor",        outcome: "Cleans up audio (noise, ums, levels), adds music + sfx beds matched to the section's mood.", skills: %w[noise-remove filler-cut music-match], integrations: %w[descript epidemic-sound notion] },
        { name: "Iris.c", role: "B-roll sourcer",      outcome: "Reads the script + finds relevant b-roll clips + stock footage. Drops them in the timeline.", skills: %w[scene-search rights-check timeline-place], integrations: %w[pexels artgrid descript] },
        { name: "Stage",  role: "Live stream director", outcome: "Pre-stream rundown, scene order, chat moderator setup, post-stream highlight cut.", skills: %w[rundown-build scene-program mod-setup], integrations: %w[streamlabs obs twitch] }
      ]
    },

    {
      name: "Paid Acquisition & Social",
      blurb: "TikTok, Instagram, Meta ads, Google ads — daily creative + bidding + reporting.",
      tone: "indigo",
      roles: [
        { name: "Tik",    role: "TikTok content planner", outcome: "30-day calendar of hooks + trends, drafts captions, schedules posts, replies to comments.", skills: %w[trend-watch hook-write comment-reply], integrations: %w[tiktok buffer notion] },
        { name: "Gram",   role: "Instagram + Reels",    outcome: "Daily feed posts + 3 reels/week from your content stream. DM responder for inbound.", skills: %w[reel-script feed-cadence dm-triage], integrations: %w[instagram buffer canva] },
        { name: "Meta",   role: "Meta ads manager",     outcome: "Builds + launches FB/IG ad campaigns, watches CPA daily, kills losing creatives, scales winners.", skills: %w[campaign-build cpa-watch creative-rotate], integrations: %w[meta-ads canva mixpanel] },
        { name: "Goo",    role: "Google ads bidder",    outcome: "Daily bid + budget adjustments based on ROAS. Negative keyword pruning. Weekly report.", skills: %w[bid-adjust negative-prune roas-report], integrations: %w[google_ads google_analytics slack] },
        { name: "Lin",    role: "LinkedIn ads + content", outcome: "B2B content engine — daily posts from leadership voice, sponsored campaigns to ICP.", skills: %w[icp-target leadership-voice sponsored-cadence], integrations: %w[linkedin-ads buffer hubspot] },
        { name: "Hype",   role: "UGC + influencer ops", outcome: "Finds creators in your niche, runs outreach + briefs, tracks deliverables + posts.", skills: %w[creator-discover brief-write deliverable-track], integrations: %w[gmail notion shopify] },
        { name: "Wit",    role: "Ad creative tester",   outcome: "Generates 10 creative variants per campaign, ships them as A/B test, kills the bottom 80%.", skills: %w[creative-variant ab-test winner-scale], integrations: %w[canva meta-ads mixpanel] },
        { name: "Snap",   role: "Snap + Pinterest",     outcome: "Daily Pin curation + Snap stories tied to your top SEO posts. Tracks click-through.", skills: %w[pin-curation snap-story click-track], integrations: %w[pinterest snapchat google_analytics] },
        { name: "Trace",  role: "Pixel + analytics watcher", outcome: "Checks pixel firing daily across all properties; alerts when a conversion event drops 20%+.", skills: %w[pixel-validate conversion-watch alert], integrations: %w[google_analytics meta-pixel slack] },
        { name: "Roi",    role: "Attribution reporter", outcome: "Weekly attribution rollup — which channel brought which signups, dollars, demos. CFO-ready.", skills: %w[multi-touch-attribution channel-mix cfo-summary], integrations: %w[mixpanel hubspot google_sheets] },
        { name: "Buzz",   role: "Community moderator",  outcome: "Watches your Discord/Slack/Circle communities — flags fires, welcomes newbies, answers FAQs.", skills: %w[mod-flag welcome-flow faq-reply], integrations: %w[discord slack circle] }
      ]
    },
    {
      name: "People & HR",
      blurb: "Hiring funnel, employee experience, the small things that compound.",
      tone: "indigo",
      roles: [
        { name: "Ren",  role: "Recruiter coordinator", outcome: "Schedules interviews across timezones, sends prep + post-interview surveys.", skills: %w[interview-scheduling prep-send survey-collect], integrations: %w[greenhouse google_calendar slack] },
        { name: "Lou",  role: "Resume screener",   outcome: "First-pass review on every application against your scorecard. Top 20% to humans.", skills: %w[scorecard-match flag-mismatch shortlist], integrations: %w[greenhouse linkedin notion] },
        { name: "Pax",  role: "Onboarding (employees)", outcome: "Week-1 plan for every new hire, sets up accounts, schedules intro coffees.", skills: %w[onboarding-plan account-provisioning intro-coffees], integrations: %w[bamboohr google_workspace slack] },
        { name: "Ivy",  role: "Engagement pulse", outcome: "Quarterly survey, weekly mood-check in Slack, summary report for execs.", skills: %w[pulse-survey mood-check anonymized-report], integrations: %w[culture_amp slack notion] },
        { name: "Rio",  role: "L&D coordinator",  outcome: "Tracks employee learning budgets, suggests courses by role, books seats.", skills: %w[course-recommend budget-tracking enrollment], integrations: %w[udemy notion slack] },
        { name: "Saul", role: "Performance review prep", outcome: "Collects 360 feedback, drafts review summaries, schedules calibrations.", skills: %w[feedback-collection summary-draft calibration-scheduling], integrations: %w[lattice gmail google_calendar] }
      ]
    },
    {
      name: "Finance & Accounting",
      blurb: "Bookkeeping, AR, AP, reporting. Tedious but high-stakes.",
      tone: "cyan",
      roles: [
        { name: "Cass", role: "AR collections",  outcome: "Watches invoices 7/14/30/60 days late, sends escalating dunning emails, books calls.", skills: %w[invoice-watch dunning-write escalation-ladder], integrations: %w[stripe quickbooks gmail] },
        { name: "Win",  role: "AP processing",   outcome: "OCRs incoming bills, matches POs, drafts payment runs for approval.", skills: %w[ocr-invoice po-match payment-batch], integrations: %w[quickbooks ramp gmail] },
        { name: "Liv",  role: "Expense auditor", outcome: "Reviews every reimbursement claim against policy, flags + drafts pushback.", skills: %w[policy-check audit-flag pushback-draft], integrations: %w[expensify slack notion] },
        { name: "Roo",  role: "Cash forecaster", outcome: "Daily runway model + scenario analysis on hires / hires / pricing changes.", skills: %w[runway-model scenario-pull commentary], integrations: %w[quickbooks google_sheets slack] },
        { name: "Mal",  role: "Investor relations", outcome: "Monthly KPIs to investors, drafts the narrative, answers common follow-ups.", skills: %w[kpi-pull narrative-draft follow-up-respond], integrations: %w[google_sheets gmail docsend] },
        { name: "Tay",  role: "Tax prep coordinator", outcome: "Collects W-9s, 1099s, sales tax filings; works with the CPA on quarterlies.", skills: %w[form-collection cpa-handoff deadline-track], integrations: %w[gusto quickbooks gmail] }
      ]
    },
    {
      name: "Founder + Personal",
      blurb: "For the human who's juggling 14 things and dropping 3 of them daily.",
      tone: "indigo",
      roles: [
        { name: "Casper", role: "Chief of Staff (founder)", outcome: "Your second brain — calendar, inbox, partner outreach, deal updates, all at once.", skills: %w[calendar inbox-triage partner-outreach deal-watch], integrations: %w[gmail google_calendar hubspot slack] },
        { name: "Echo",   role: "Investor inbox",  outcome: "Triages investor emails, drafts replies in your voice, schedules updates.", skills: %w[investor-tone update-draft schedule], integrations: %w[gmail docsend google_calendar] },
        { name: "Glen",   role: "Networking + intros", outcome: "Tracks who you owe an intro / reply to. Drafts both sides of warm intros.", skills: %w[contact-tracking intro-write follow-through], integrations: %w[gmail linkedin notion] },
        { name: "Mae",    role: "Reading list curator", outcome: "Watches your highlights, surfaces what to read this week, summarizes one piece.", skills: %w[highlight-track relevance-rank summarize], integrations: %w[readwise notion slack] },
        { name: "Bo",     role: "Birthday + gifts",  outcome: "Remembers every important date in your network, suggests a gift, orders it.", skills: %w[date-track gift-suggest order], integrations: %w[notion amazon gmail] },
        { name: "Tess.p", role: "Personal travel",   outcome: "Plans your vacation — flights, hotels, restaurants, itinerary in your inbox.", skills: %w[trip-plan booking itinerary-build], integrations: %w[gmail kayak google_calendar] }
      ]
    },
    {
      name: "Product & Research",
      blurb: "Discovery, validation, prioritization — without doing 40 customer calls yourself.",
      tone: "cyan",
      roles: [
        { name: "Drew",  role: "User research coordinator", outcome: "Recruits target users for interviews, sends prep, schedules, follows up.", skills: %w[recruit screen schedule], integrations: %w[user_interviews calendly gmail] },
        { name: "Jules", role: "Interview synthesizer", outcome: "Watches/reads every customer call transcript, extracts themes, builds insight wiki.", skills: %w[transcript-analysis theme-cluster wiki-update], integrations: %w[gong notion otter] },
        { name: "Nori",  role: "Competitive watcher", outcome: "Daily scan of competitor changelogs, blog posts, hires. Weekly digest.", skills: %w[competitive-monitor diff-detect digest], integrations: %w[productHunt linkedin notion] },
        { name: "Rex",   role: "Feature prioritizer", outcome: "Scores requests by RICE, frequency, and customer tier. Posts ranked backlog weekly.", skills: %w[rice-scoring frequency-pull tier-weight], integrations: %w[productboard linear hubspot] },
        { name: "Yael",  role: "Beta program manager", outcome: "Runs beta cohorts — invites, gathers feedback, ships changes, graduates users.", skills: %w[beta-cohort feedback-collect changelog-track], integrations: %w[mixpanel slack linear] },
        { name: "Coro",  role: "Survey designer", outcome: "Designs + ships product surveys, analyzes results, posts what to do about them.", skills: %w[survey-design analysis recommendation], integrations: %w[typeform mixpanel notion] }
      ]
    },
    {
      name: "Legal & Compliance",
      blurb: "Contract gauntlet, GDPR drudgery, security questionnaires. AI shines here.",
      tone: "indigo",
      roles: [
        { name: "Wes",  role: "Contract reviewer",   outcome: "Reads every incoming contract, flags off-standard terms, suggests redlines.", skills: %w[contract-redline standard-check escalation], integrations: %w[docusign ironclad slack] },
        { name: "Nix",  role: "DPA responder",       outcome: "Handles data-processing-agreement requests from customers. Pre-fills your template.", skills: %w[dpa-template gap-check redline], integrations: %w[notion docusign gmail] },
        { name: "Sage", role: "Security questionnaire", outcome: "Fills out customer security questionnaires from your knowledge base in hours, not days.", skills: %w[questionnaire-answer kb-lookup gap-flag], integrations: %w[vanta notion gmail] },
        { name: "Ant",  role: "GDPR DSAR handler",   outcome: "Processes data-subject-access requests on schedule. Compiles + reviews exports.", skills: %w[dsar-intake export-compile review], integrations: %w[gmail hubspot slack] }
      ]
    },
    {
      name: "Healthcare Ops",
      blurb: "Built by a medical scribing team — agents that know HIPAA-adjacent work.",
      tone: "cyan",
      roles: [
        { name: "Hal",   role: "Patient intake",     outcome: "Pre-visit triage form follow-up, history collection, scheduling.", skills: %w[history-collect schedule reminder], integrations: %w[athenaone gmail twilio] },
        { name: "Indi",  role: "Prior auth",         outcome: "Drafts prior authorization requests, follows up with payers, tracks status.", skills: %w[pa-draft payer-followup status-track], integrations: %w[athenaone gmail fax-api] },
        { name: "Dot",   role: "Billing coder",      outcome: "Suggests ICD-10 codes from visit notes, flags ambiguities, queues for human review.", skills: %w[icd-coding ambiguity-flag review-queue], integrations: %w[athenaone notion slack] },
        { name: "Rae",   role: "Patient follow-up",  outcome: "Post-visit check-ins, refill reminders, surveys. Escalates issues to nurses.", skills: %w[check-in refill survey escalation], integrations: %w[twilio gmail athenaone] }
      ]
    }
  ].freeze
  # rubocop:enable Layout/LineLength
end
