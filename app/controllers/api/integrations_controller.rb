require "net/http"
require "json"

# Single source of truth for which integrations are usable: queries Composio's
# /api/v3/auth_configs and returns the list of toolkit slugs + display labels
# that have an auth_config wired up. The engine fetches this at boot + every
# 30 min so propose_connection only ever surfaces Connect cards for things
# that will actually work.
class Api::IntegrationsController < ActionController::API
  before_action :authenticate_engine!

  # GET /api/integrations/supported
  def supported
    api_key = ENV["COMPOSIO_API_KEY"]
    return render(json: { items: [] }) if api_key.blank?

    items = fetch_auth_configs(api_key)
    render json: { items: items }
  rescue => e
    Rails.logger.warn "GET /api/integrations/supported failed: #{e.class}: #{e.message}"
    render json: { items: [], error: e.message }, status: :ok # don't break engine boot
  end

  private

  def fetch_auth_configs(api_key)
    uri = URI("https://backend.composio.dev/api/v3/auth_configs?limit=200")
    req = Net::HTTP::Get.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 10) { |http| http.request(req) }
    return [] unless res.is_a?(Net::HTTPSuccess)

    data = JSON.parse(res.body)
    raw = data["items"] || data || []

    # Dedupe by slug — multiple auth_configs per toolkit are possible (OAuth
    # vs API key etc.); we only need to know the toolkit is connectable.
    seen = {}
    Array(raw).each do |cfg|
      slug = (cfg.dig("toolkit", "slug") || "").downcase
      next if slug.blank?
      seen[slug] ||= {
        slug: slug,
        label: cfg.dig("toolkit", "name") || slug.titleize,
      }
    end
    seen.values.sort_by { |i| i[:label].to_s }
  end

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
