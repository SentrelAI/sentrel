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
  #
  # All hot-path reads come from composio_toolkit_caches (org-scoped). The
  # cache is populated by RefreshComposioCacheJob (hourly cron + on-demand
  # from /integrations). If the cache is empty (fresh install / job hasn't
  # run yet) we fall back to a synchronous Composio fetch + immediate cache
  # write so the user sees something instead of an empty page.

  # Full list for the integrations page.
  # Returns: [{ slug, label, category, description, logo, available }]
  def self.list(organization_id)
    rows = ComposioToolkitCache.where(organization_id: organization_id).order(:label)
    rows = backfill_sync(organization_id) if rows.empty?

    rows
      .reject { |r| HIDDEN_SLUGS.include?(r.slug) }
      .map { |r|
        {
          slug:        r.slug,
          label:       r.label,
          category:    r.category || "Other",
          description: r.description,
          logo:        r.logo,
          available:   r.available,
        }
      }
      .sort_by { |r| [r[:available] ? 0 : 1, r[:label].to_s.downcase] }
  end

  # Slim list for the engine — only services with a working auth_config.
  def self.list_for_engine(organization_id)
    rows = ComposioToolkitCache.where(organization_id: organization_id, available: true).order(:label)
    rows = backfill_sync(organization_id).select(&:available) if rows.empty?
    rows.map { |r| { slug: r.slug, label: r.label } }
  end

  # First-call backfill: populates the cache synchronously for an org with
  # no rows yet. Returns the freshly-inserted ActiveRecord rows so callers
  # don't need a second query.
  def self.backfill_sync(organization_id)
    Rails.logger.info "ComposioSupported.backfill_sync: empty cache for org=#{organization_id}, syncing now"
    RefreshComposioCacheJob.new.perform(organization_id)
    ComposioToolkitCache.where(organization_id: organization_id).order(:label).to_a
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
      # Composio's /toolkits is cursor-paginated; a single page can't fit the
      # full ~600+ toolkit catalog, so a slug like `vercel` may sit on page 2
      # and never make it into our local cache. Walk every page until empty
      # or until we hit a sane safety cap.
      out = []
      cursor = nil
      pages = 0
      loop do
        pages += 1
        break if pages > 10 # safety cap (~5000 toolkits)
        params = +"limit=500"
        params << "&cursor=#{CGI.escape(cursor)}" if cursor
        uri = URI("#{COMPOSIO_BASE}/api/v3/toolkits?#{params}")
        req = Net::HTTP::Get.new(uri)
        req["x-api-key"] = api_key
        req["Content-Type"] = "application/json"
        res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 8) { |http| http.request(req) }
        raise "Composio /toolkits #{res.code}" unless res.is_a?(Net::HTTPSuccess)

        data = JSON.parse(res.body)
        raw = data["items"] || data || []
        Array(raw).each do |t|
          slug = (t["slug"] || t["name"] || "").to_s.downcase
          next if slug.blank?
          out << {
            slug: slug,
            label: t["name"] || slug.titleize,
            description: t["description"] || t["meta"]&.dig("description"),
            logo: t["logo"] || t.dig("meta", "logo"),
            categories: extract_categories(t),
          }
        end
        cursor = data["next_cursor"] || data.dig("pagination", "next_cursor")
        break if cursor.blank? || raw.empty?
      end
      out
    end
  rescue => e
    Rails.logger.warn "ComposioSupported.fetch_toolkits failed: #{e.class}: #{e.message}"
    fallback_toolkits
  end

  def self.fetch_auth_configs(force: false)
    api_key = ENV["COMPOSIO_API_KEY"]
    return [] if api_key.blank?

    cache_key = "composio:auth_configs"
    Rails.cache.delete(cache_key) if force

    Rails.cache.fetch(cache_key, expires_in: 5.minutes) do
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

  # Extract category strings from Composio's toolkit response. Composio has
  # changed the field shape across API versions; try every spot we've seen
  # one before falling back to empty. Returns an Array<String> of titleized
  # category names.
  def self.extract_categories(toolkit_payload)
    raw = toolkit_payload["categories"] ||
          toolkit_payload.dig("meta", "categories") ||
          toolkit_payload["category"] ||
          toolkit_payload.dig("meta", "category")

    list = case raw
    when Array
      raw.map { |c| c.is_a?(Hash) ? (c["name"] || c["label"] || c["slug"]) : c.to_s }
    when String
      raw.split(",")
    when Hash
      [raw["name"] || raw["label"] || raw["slug"]]
    else
      []
    end

    list.compact.map { |c| normalize_category(c) }.reject(&:blank?).uniq
  end

  # Categories Composio publishes that we drop entirely (junk / placeholders).
  # Includes a regex catch-all for Composio's `tagN` placeholder pattern.
  CATEGORY_DROPLIST = Set.new(%w[]).freeze
  CATEGORY_DROP_REGEX = /\Atag\d+\z/i

  # Synonyms collapsed before we display so "ecommerce" + "e_commerce" don't
  # show as two buckets, etc. Keys are the post-normalize form; values are
  # the canonical bucket they should fold into.
  CATEGORY_SYNONYMS = {
    "E Commerce" => "Ecommerce",
    "Developer Tools & DevOps" => "Developer Tools",
    "Productivity & Project Management" => "Project Management",
  }.freeze

  # Normalise category strings so "ai-tools" / "AI Tools" / "ai_tools" all
  # collapse to the same "AI Tools" bucket on the page. Returns "" for
  # values on the droplist (caller filters those out).
  def self.normalize_category(raw)
    s = raw.to_s.gsub(/[_-]+/, " ").strip.downcase
    return "" if s.empty? || CATEGORY_DROPLIST.include?(s) || s.match?(CATEGORY_DROP_REGEX)
    # Title-case while preserving common acronyms + a few mixed-case words
    # we want to keep cased correctly (DevOps, IoT, etc.).
    acronyms = %w[ai api crm cms hr seo sms it sql url ip iot api crm hr]
    mixed_case = { "devops" => "DevOps", "iot" => "IoT", "saas" => "SaaS", "javascript" => "JavaScript" }
    titled = s.split(/\s+/).map { |w|
      lw = w.downcase
      next mixed_case[lw] if mixed_case.key?(lw)
      next w.upcase if acronyms.include?(lw)
      w.capitalize
    }.join(" ")
    CATEGORY_SYNONYMS[titled] || titled
  end
end
