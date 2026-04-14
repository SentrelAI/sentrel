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

created = 0
updated = 0

SKILLS.each do |attrs|
  # Load SKILL.md content from file if available
  file_path = FILE_MAP[attrs[:slug]]
  skill_md = if file_path && File.exist?(File.join(skill_dir, file_path))
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
