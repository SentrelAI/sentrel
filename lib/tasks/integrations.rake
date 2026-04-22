require "net/http"
require "json"

namespace :integrations do
  desc "Probe Composio: verify API key, list auth_configs, show active connections per org"
  task check: :environment do
    api_key = ENV["COMPOSIO_API_KEY"].to_s
    if api_key.empty?
      puts "✗ COMPOSIO_API_KEY not set in Rails environment"
      exit 1
    end
    puts "✓ COMPOSIO_API_KEY set"

    # 1) Fetch all auth_configs
    res = composio_get("/api/v3/auth_configs", api_key)
    unless res.is_a?(Net::HTTPSuccess)
      puts "✗ Composio API rejected key (HTTP #{res.code}) — check key is valid and not revoked"
      exit 1
    end

    data  = JSON.parse(res.body) rescue {}
    items = data["items"] || data || []
    configured_slugs = Array(items).map { |c| (c.dig("toolkit", "slug") || "").downcase }.compact.reject(&:empty?).to_set
    puts "✓ Composio API reachable (#{configured_slugs.size} auth_configs registered)"

    # 2) Report per-service status for the UI-curated list
    curated = %w[
      apollo hubspot linkedin
      gmail slack intercom
      googlecalendar googlesheets googledrive notion airtable calendly
      github linear vercel
      stripe
      twitter figma mailchimp typeform digital_ocean
    ]
    puts ""
    puts "Curated services:"
    curated.each do |slug|
      if configured_slugs.include?(slug)
        puts "  ✓ #{slug}"
      else
        puts "  ✗ #{slug} (not configured in Composio dashboard)"
      end
    end

    # 3) Per-org connection status
    puts ""
    puts "Active connections per org:"
    Organization.find_each do |org|
      user_id = "org_#{org.id}"
      conn_res = composio_get("/api/v3/connected_accounts?user_ids=#{user_id}&statuses=ACTIVE", api_key)
      if conn_res.is_a?(Net::HTTPSuccess)
        conn_items = (JSON.parse(conn_res.body)["items"] rescue []) || []
        slugs = conn_items.map { |c| c.dig("toolkit", "slug") }.compact
        puts "  org ##{org.id} (#{org.slug}): #{slugs.any? ? "#{slugs.size} active: #{slugs.join(", ")}" : "0 active"}"
      else
        puts "  org ##{org.id} (#{org.slug}): error fetching (HTTP #{conn_res.code})"
      end
    end
  end

  def composio_get(path, api_key)
    uri = URI("https://backend.composio.dev#{path}")
    req = Net::HTTP::Get.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 10) { |http| http.request(req) }
  rescue Net::OpenTimeout, Net::ReadTimeout, Errno::ECONNREFUSED, SocketError => e
    puts "  (network error: #{e.class}: #{e.message})"
    Struct.new(:code, :body).new("599", "{}")
  end
end
