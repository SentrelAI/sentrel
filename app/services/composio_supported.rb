require "net/http"
require "json"

# Source of truth for which integrations the workspace can use.
#
# Three Composio endpoints:
#   /api/v3/toolkits     — Composio's FULL catalog (250+ services). Labels +
#                          logos + descriptions live here.
#   /api/v3/auth_configs — what this workspace has wired up. Drives the
#                          `available: true|false` flag.
#   /api/v3/tools        — actions a toolkit exposes. Cached per-slug for
#                          the future privilege/permission system.
#
# The page (/integrations) and the engine cache both call this service so
# they never drift.
class ComposioSupported
  COMPOSIO_BASE = "https://backend.composio.dev".freeze

  # Light category mapping for the page's grouping. Composio doesn't categorize
  # toolkits server-side, so we curate this locally. Anything not in the map
  # lands under 'Other'.
  CATEGORY_MAP = {
    # Sales / CRM
    "apollo"          => "Sales",
    "hubspot"         => "Sales",
    "linkedin"        => "Sales",
    "salesforce"      => "Sales",
    "pipedrive"       => "Sales",
    "outreach"        => "Sales",
    "salesloft"       => "Sales",
    "zoho"            => "Sales",

    # Communication
    "gmail"           => "Communication",
    "slack"           => "Communication",
    "intercom"        => "Communication",
    "discord"         => "Communication",
    "outlook"         => "Communication",
    "zoom"            => "Communication",
    "telegram"        => "Communication",
    "whatsapp"        => "Communication",

    # Productivity
    "googlecalendar"  => "Productivity",
    "googlesheets"    => "Productivity",
    "googledrive"     => "Productivity",
    "googledocs"      => "Productivity",
    "google_docs"     => "Productivity",
    "notion"          => "Productivity",
    "airtable"        => "Productivity",
    "calendly"        => "Productivity",
    "asana"           => "Productivity",
    "trello"          => "Productivity",
    "clickup"         => "Productivity",
    "monday"          => "Productivity",

    # Engineering
    "github"          => "Engineering",
    "linear"          => "Engineering",
    "vercel"          => "Engineering",
    "digital_ocean"   => "Engineering",
    "gitlab"          => "Engineering",
    "bitbucket"       => "Engineering",
    "jira"            => "Engineering",
    "sentry"          => "Engineering",

    # Finance
    "stripe"          => "Finance",
    "quickbooks"      => "Finance",
    "xero"            => "Finance",

    # Content / Marketing
    "twitter"         => "Content",
    "x"               => "Content",
    "figma"           => "Content",
    "mailchimp"       => "Content",
    "typeform"        => "Content",
    "youtube"         => "Content",
    "tiktok"          => "Content",
    "instagram"       => "Content",
    "wordpress"       => "Content",
    "webflow"         => "Content",
    "framer"          => "Content",
  }.freeze

  # Toolkits Composio publishes that we don't want surfaced even if available.
  # Add slugs here to hide them (legacy, dev-only, broken integrations).
  HIDDEN_SLUGS = Set.new(%w[]).freeze

  # ── Public API ────────────────────────────────────────────────────────────

  # Full list for the integrations page.
  # Returns: [{ slug, label, category, description, logo, available }]
  def self.list
    toolkits = fetch_toolkits
    available = fetch_auth_configs.map { |c| c[:slug] }.to_set

    rows = toolkits.reject { |t| HIDDEN_SLUGS.include?(t[:slug]) }.map do |t|
      {
        slug:        t[:slug],
        label:       prettify_label(t[:label]),
        category:    CATEGORY_MAP[t[:slug]] || "Other",
        description: t[:description],
        logo:        t[:logo],
        available:   available.include?(t[:slug]),
      }
    end

    # Sort: connected first, then alphabetical within category. Page groups
    # by category later so this sort is mostly cosmetic for that grouping.
    rows.sort_by { |r| [r[:available] ? 0 : 1, r[:label].to_s.downcase] }
  end

  # Slim list for the engine — only services with a working auth_config.
  def self.list_for_engine
    list.select { |s| s[:available] }.map { |s| s.slice(:slug, :label) }
  end

  # Tools (actions) a toolkit exposes. Cached for the future privilege system
  # so users can grant agents per-action access (e.g. "GMAIL_SEND_EMAIL but
  # not GMAIL_DELETE_THREAD"). Returns [{slug, name, description}].
  def self.tools_for(toolkit_slug)
    Rails.cache.fetch("composio:tools:#{toolkit_slug}", expires_in: 1.hour) do
      fetch_tools(toolkit_slug)
    end
  end

  # ── Composio fetchers ─────────────────────────────────────────────────────

  def self.fetch_toolkits
    api_key = ENV["COMPOSIO_API_KEY"]
    return fallback_toolkits if api_key.blank?

    Rails.cache.fetch("composio:toolkits", expires_in: 1.hour) do
      uri = URI("#{COMPOSIO_BASE}/api/v3/toolkits?limit=500")
      req = Net::HTTP::Get.new(uri)
      req["x-api-key"] = api_key
      req["Content-Type"] = "application/json"
      # Tight timeouts; let the cache-fallback path absorb misses.
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 6) { |http| http.request(req) }
      raise "Composio /toolkits #{res.code}" unless res.is_a?(Net::HTTPSuccess)

      data = JSON.parse(res.body)
      raw = data["items"] || data || []
      Array(raw).filter_map do |t|
        slug = (t["slug"] || t["name"] || "").to_s.downcase
        next if slug.blank?
        {
          slug: slug,
          label: t["name"] || slug.titleize,
          description: t["description"] || t["meta"]&.dig("description"),
          logo: t["logo"] || t.dig("meta", "logo"),
        }
      end
    end
  rescue => e
    Rails.logger.warn "ComposioSupported.fetch_toolkits failed: #{e.class}: #{e.message}"
    fallback_toolkits
  end

  def self.fetch_auth_configs
    api_key = ENV["COMPOSIO_API_KEY"]
    return [] if api_key.blank?

    Rails.cache.fetch("composio:auth_configs", expires_in: 5.minutes) do
      uri = URI("#{COMPOSIO_BASE}/api/v3/auth_configs?limit=200")
      req = Net::HTTP::Get.new(uri)
      req["x-api-key"] = api_key
      req["Content-Type"] = "application/json"
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 6) { |http| http.request(req) }
      next [] unless res.is_a?(Net::HTTPSuccess)

      data = JSON.parse(res.body)
      raw = data["items"] || data || []
      seen = {}
      Array(raw).each do |cfg|
        slug = (cfg.dig("toolkit", "slug") || "").downcase
        next if slug.blank?
        seen[slug] ||= { slug: slug }
      end
      seen.values
    end
  rescue => e
    Rails.logger.warn "ComposioSupported.fetch_auth_configs failed: #{e.class}: #{e.message}"
    Rails.cache.read("composio:auth_configs") || []
  end

  def self.fetch_tools(toolkit_slug)
    api_key = ENV["COMPOSIO_API_KEY"]
    return [] if api_key.blank?

    uri = URI("#{COMPOSIO_BASE}/api/v3/tools?toolkits=#{toolkit_slug}&limit=200")
    req = Net::HTTP::Get.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 6) { |http| http.request(req) }
    return [] unless res.is_a?(Net::HTTPSuccess)

    data = JSON.parse(res.body)
    raw = data["items"] || data || []
    Array(raw).filter_map do |t|
      slug = (t["slug"] || t["name"] || "").to_s
      next if slug.blank?
      {
        slug: slug,
        name: t["display_name"] || t["name"] || slug,
        description: t["description"],
      }
    end
  rescue => e
    Rails.logger.warn "ComposioSupported.fetch_tools(#{toolkit_slug}) failed: #{e.class}: #{e.message}"
    []
  end

  # Minimal fallback when the Composio API is unreachable on first boot.
  # The cache picks up the real list as soon as Composio is reachable again.
  def self.fallback_toolkits
    [
      { slug: "apollo",         label: "Apollo",          description: "CRM and lead generation",   logo: nil },
      { slug: "googlesheets",   label: "Google Sheets",   description: "Spreadsheets",              logo: nil },
      { slug: "gmail",          label: "Gmail",           description: "Email via Google",          logo: nil },
      { slug: "linkedin",       label: "LinkedIn",        description: "Professional network",      logo: nil },
      { slug: "hubspot",        label: "HubSpot",         description: "CRM, marketing, sales",     logo: nil },
      { slug: "slack",          label: "Slack",           description: "Team messaging",            logo: nil },
      { slug: "notion",         label: "Notion",          description: "Docs and wiki",             logo: nil },
    ]
  end

  # Composio's display names ("Hubspot", "Linkedin", "Googlesheets") have
  # broken casing for some toolkits. Apply a small set of overrides.
  LABEL_OVERRIDES = {
    "hubspot"        => "HubSpot",
    "linkedin"       => "LinkedIn",
    "googlesheets"   => "Google Sheets",
    "googlecalendar" => "Google Calendar",
    "googledrive"    => "Google Drive",
    "googledocs"     => "Google Docs",
    "google_docs"    => "Google Docs",
    "github"         => "GitHub",
    "gitlab"         => "GitLab",
    "youtube"        => "YouTube",
    "tiktok"         => "TikTok",
    "wordpress"      => "WordPress",
    "digital_ocean"  => "DigitalOcean",
    "x"              => "X (Twitter)",
    "twitter"        => "Twitter / X",
  }.freeze

  def self.prettify_label(name)
    return name if name.blank?
    slug = name.to_s.downcase.gsub(/\s+/, "")
    LABEL_OVERRIDES[slug] || name
  end
end
