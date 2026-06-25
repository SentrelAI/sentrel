# Loads the static integration catalog (config/integrations.yml) and exposes
# it in the shape the Integrations page + engine expect. Replaces the live
# Composio toolkit catalog (ComposioSupported / ComposioToolkitCache) — the
# catalog is now code, not a per-org API sync, so there's no cache/refresh job.
#
# An entry is a plain Hash with indifferent-ish access via symbol keys.
class IntegrationCatalog
  CONFIG_PATH = Rails.root.join("config", "integrations.yml")

  class << self
    # All catalog entries as [{ slug:, label:, category:, ... }], label-sorted.
    def all
      load_catalog.map { |slug, attrs| entry(slug, attrs) }.sort_by { |e| e[:label].to_s.downcase }
    end

    # One entry by service slug, or nil.
    def find(slug)
      attrs = load_catalog[slug.to_s]
      attrs && entry(slug.to_s, attrs)
    end

    def exists?(slug)
      load_catalog.key?(slug.to_s)
    end

    # Integrations-page list, synced with what's actually configured in Nango.
    #
    # `configured_keys` = the provider_config_keys that have a Nango integration
    # set up (from Nango::Client.configured_provider_keys). An app's OAuth modes
    # (managed / byo_oauth) only work if its key is wired in Nango, so:
    #   - oauth_ready  : the app's provider_config_key is configured in Nango
    #   - modes        : OAuth modes are dropped unless oauth_ready (paste-token
    #                    never needs Nango, so it stays)
    #   - available    : connectable now — oauth_ready, OR a paste-token/api_key
    #                    app, OR a dedicated MCP. Otherwise the UI shows "Request"
    #                    (greyed) instead of a Connect button.
    #
    # If `configured_keys` is blank (Nango unreachable / nothing configured), we
    # degrade gracefully: every app stays available, so a transient Nango blip
    # never makes the whole grid look broken.
    # Returns: [{ slug, label, category, description, logo, available, oauth_ready,
    #             modes, auth_type, review, tool, docs_url }]
    def list(_organization_id = nil, configured_keys: nil)
      keys = configured_keys
      all.map do |e|
        if keys.blank?
          e.merge(available: true, oauth_ready: nil)
        else
          oauth_ready = e[:provider_config_key].present? && keys.include?(e[:provider_config_key])
          modes = e[:modes].reject { |m| %w[managed byo_oauth].include?(m) && !oauth_ready }
          available = oauth_ready || e[:tool] == "mcp" || (e[:auth_type] == "api_key" && modes.include?("byo_token"))
          e.merge(available: available, oauth_ready: oauth_ready, modes: modes)
        end
      end
    end

    # Slim list for the engine — slug + label + api_base_url so nango_request
    # knows where to route. Connection state is layered on by the API endpoint.
    def list_for_engine(_organization_id = nil)
      all.map { |e| { slug: e[:slug], label: e[:label], api_base_url: e[:api_base_url], tool: e[:tool] } }
    end

    def slugs
      load_catalog.keys
    end

    def categories
      all.map { |e| e[:category] }.uniq.sort
    end

    # The Nango provider_config_key for a slug (managed/byo_oauth), or nil for
    # api_key / mcp apps.
    def provider_config_key(slug)
      find(slug)&.dig(:provider_config_key)
    end

    def reload!
      @catalog = nil
    end

    private

    def load_catalog
      @catalog ||= YAML.safe_load_file(CONFIG_PATH) || {}
    end

    def entry(slug, attrs)
      {
        slug: slug,
        label: attrs["label"] || slug.humanize,
        category: attrs["category"] || "Other",
        description: attrs["description"],
        logo: attrs["logo"],
        provider_config_key: attrs["provider_config_key"],
        auth_type: attrs["auth_type"] || "oauth2",
        api_base_url: attrs["api_base_url"],
        docs_url: attrs["docs_url"],
        scopes: attrs["scopes"] || [],
        modes: attrs["modes"] || %w[managed],
        tool: attrs["tool"] || "proxy",
        review: attrs["review"] || "none"
      }
    end
  end
end
