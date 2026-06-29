module Nango
  # Populates the catalog_apps table from Nango's /providers template catalog
  # (~872 apps). Runs on a cron + on-demand. Idempotent upsert keyed by slug.
  #
  # Sync owns the Nango-sourced + policy columns; it preserves the admin-owned
  # `published` / `position` across runs (so hiding/ordering an app sticks).
  module CatalogSync
    module_function

    # Logos are served by Nango at /images/template-logos/<slug>.svg. We point at
    # connect.sentrel.ai (our clean domain), not the nango-admin host.
    LOGO_BASE = "https://connect.sentrel.ai/images/template-logos".freeze

    # Policy overrides Nango can't know, keyed by provider slug:
    #   tool:   "mcp" routes the app to a dedicated MCP server (not the proxy)
    #   review: "gated" forces human approval on writes (mirrors /api/secrets)
    OVERRIDES = {
      "facebook"            => { tool: "mcp", review: "gated" },
      "facebook-business"   => { review: "gated" },
      "linkedin"            => { review: "gated" },
      "tiktok-ads"          => { review: "gated" },
      "tiktok-accounts"     => { review: "gated" }
    }.freeze

    # Curated directory apps that aren't Nango provider templates — dedicated
    # MCP servers we host. Surfaced in the main grid like any other app, but
    # Connect routes to the MCP OAuth flow (tool: mcp + mcp_url), NOT Nango.
    CURATED = [
      {
        slug: "meta_ads", label: "Meta Ads", category: "Marketing",
        categories: %w[marketing popular],
        logo: "/integration-logos/meta_ads.svg", auth_mode: "OAUTH2",
        api_base_url: "https://graph.facebook.com",
        docs_url: "https://developers.facebook.com/docs/marketing-apis",
        tool: "mcp", review: "gated", mcp_url: "https://sentrel-meta-mcp.fly.dev/mcp"
      }
    ].freeze

    # Nango category slug -> display label for the sidebar.
    CATEGORY_LABELS = {
      "accounting" => "Accounting", "analytics" => "Analytics", "ats" => "Recruiting",
      "banking" => "Banking", "cms" => "CMS", "communication" => "Communication",
      "crm" => "CRM", "design" => "Design", "dev-tools" => "Developer",
      "e-commerce" => "E-Commerce", "erp" => "ERP", "gaming" => "Gaming", "hr" => "HR",
      "iam" => "Identity", "invoicing" => "Invoicing", "knowledge-base" => "Knowledge Base",
      "legal" => "Legal", "marketing" => "Marketing", "mcp" => "MCP", "other" => "Other",
      "payment" => "Payments", "productivity" => "Productivity", "search" => "Search",
      "social" => "Social", "sports" => "Sports", "storage" => "Storage",
      "support" => "Support", "surveys" => "Surveys", "ticketing" => "Ticketing",
      "video" => "Video"
    }.freeze

    # "popular" is a cross-cutting tag (drives `featured`), not a real category.
    NON_CATEGORY = %w[popular other].freeze

    def run
      providers = Nango::Client.list_providers
      return { synced: 0, skipped: "nango unreachable / empty" } if providers.empty?

      rows = providers.filter_map { |p| build_row(p) }
      return { synced: 0 } if rows.empty?
      rows += CURATED.map { |c| build_curated_row(c) }

      CatalogApp.upsert_all(
        rows,
        unique_by: :slug,
        update_only: %i[label display_name category categories logo auth_mode
                        api_base_url docs_url scopes modes tool review featured mcp_url],
      )
      { synced: rows.size }
    end

    # A curated MCP app (Meta Ads) — not from /providers; carries the MCP URL.
    def build_curated_row(c)
      now = Time.current
      {
        slug: c[:slug], label: c[:label], display_name: c[:label],
        category: c[:category], categories: Array(c[:categories]),
        logo: c[:logo], auth_mode: c[:auth_mode], api_base_url: c[:api_base_url],
        docs_url: c[:docs_url], scopes: [], modes: [],
        tool: c[:tool] || "mcp", review: c[:review] || "none",
        featured: Array(c[:categories]).include?("popular"),
        published: true, position: 0, mcp_url: c[:mcp_url],
        created_at: now, updated_at: now
      }
    end

    def build_row(p)
      slug = (p["name"] || p["unique_key"]).to_s
      return nil if slug.blank?
      cats = Array(p["categories"])
      ov = OVERRIDES[slug] || {}
      now = Time.current
      {
        slug: slug,
        label: clean_label(p["display_name"], slug),
        display_name: p["display_name"],
        category: primary_category(cats),
        categories: cats,
        logo: "#{LOGO_BASE}/#{slug}.svg",
        auth_mode: p["auth_mode"],
        api_base_url: p.dig("proxy", "base_url"),
        docs_url: p["docs"],
        scopes: [], # scopes are configured per-integration in Nango, not in the directory
        modes: modes_for(p["auth_mode"]),
        tool: ov[:tool] || "proxy",
        review: ov[:review] || "none",
        featured: cats.include?("popular"),
        published: true,
        position: 0,
        mcp_url: nil, # Nango provider apps connect via the proxy, not an MCP
        created_at: now,
        updated_at: now
      }
    end

    # "GitHub (User OAuth)" -> "GitHub" ; "Stripe (API Key)" -> "Stripe".
    def clean_label(display, slug)
      base = display.to_s.sub(/\s*\(.*\)\s*\z/, "").strip
      base.presence || slug.tr("-_", " ").split.map(&:capitalize).join(" ")
    end

    def primary_category(cats)
      real = (cats - NON_CATEGORY).first
      CATEGORY_LABELS[real] || "Other"
    end

    def modes_for(auth_mode)
      auth_mode.to_s.upcase.start_with?("OAUTH") ? %w[managed byo_oauth] : %w[managed]
    end
  end
end
