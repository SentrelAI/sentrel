require "net/http"

module Email
  # Auto-configures the SES DNS records for an email domain when the user's
  # domain falls under a zone we manage on Cloudflare. Spares the user from
  # copy/pasting 6 records into their DNS provider — the common case for our
  # *.double.md / *.scribemd.ai shared zones.
  #
  # Env required:
  #   MANAGED_DNS_ZONES=double.md,scribemd.ai   — comma-sep zones we own
  #   CLOUDFLARE_API_KEY=<bearer or global key>  — auth for the Cloudflare API
  #
  # Behaviour:
  # - .managed?(domain) — does this domain fall under one of our zones?
  # - .apply!(domain, records) — idempotently create each record on Cloudflare;
  #   reuses existing records when the (type, name, content) tuple matches.
  module DnsAutoConfigurator
    module_function

    CF_API = "https://api.cloudflare.com/client/v4".freeze

    # Returns the parent managed zone for `domain` if any, else nil.
    # "casper.ghost.double.md" → "double.md" when "double.md" is managed.
    def managed_zone_for(domain)
      managed_zones.find { |z| domain == z || domain.end_with?(".#{z}") }
    end

    def managed?(domain)
      !managed_zone_for(domain).nil?
    end

    # Applies records to Cloudflare. Returns { applied: [...], skipped: [...], errors: [...] }.
    # Idempotent: an existing record with the same (type, name, content) is left alone.
    def apply!(domain, records)
      zone = managed_zone_for(domain)
      raise "Domain #{domain} is not in a managed zone (#{managed_zones.join(', ')})" unless zone

      zone_id = zone_id_for(zone)
      raise "Cloudflare zone #{zone} not found in account" unless zone_id

      applied = []
      skipped = []
      errors  = []

      records.each do |rec|
        type    = rec[:type] || rec["type"]
        name    = rec[:name] || rec["name"]
        value   = rec[:value] || rec["value"]
        purpose = rec[:purpose] || rec["purpose"]

        # MX records carry a priority embedded in the value ("10 host"). Split.
        priority = nil
        content  = value
        if type == "MX" && value =~ /\A(\d+)\s+(.+)\z/
          priority = Regexp.last_match(1).to_i
          content  = Regexp.last_match(2)
        end

        existing = find_record(zone_id, type:, name:)
        match = existing.find { |e| e["content"] == content && (type != "MX" || e["priority"] == priority) }
        if match
          skipped << { type:, name:, purpose:, reason: "already present" }
          next
        end

        body = { type:, name:, content:, ttl: 300 }
        body[:priority] = priority if priority

        res = cf_post("/zones/#{zone_id}/dns_records", body)
        if res["success"]
          applied << { type:, name:, purpose: }
        else
          msg = (res["errors"] || []).map { |e| e["message"] }.join("; ").presence || "unknown error"
          errors << { type:, name:, purpose:, error: msg }
        end
      end

      { applied:, skipped:, errors:, zone: }
    end

    # ── internals ──────────────────────────────────────────────────────────

    def managed_zones
      ENV.fetch("MANAGED_DNS_ZONES", "").split(",").map(&:strip).reject(&:empty?)
    end

    def cloudflare_token
      ENV["CLOUDFLARE_API_KEY"].to_s
    end

    def zone_id_for(zone)
      res = cf_get("/zones?name=#{zone}")
      res.dig("result", 0, "id")
    end

    def find_record(zone_id, type:, name:)
      res = cf_get("/zones/#{zone_id}/dns_records?type=#{type}&name=#{name}")
      Array(res["result"])
    end

    def cf_get(path)
      uri = URI.parse(CF_API + path)
      req = Net::HTTP::Get.new(uri)
      req["Authorization"] = "Bearer #{cloudflare_token}"
      req["Content-Type"]  = "application/json"
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 15, open_timeout: 5) { |h| JSON.parse(h.request(req).body) }
    end

    def cf_post(path, body)
      uri = URI.parse(CF_API + path)
      req = Net::HTTP::Post.new(uri)
      req["Authorization"] = "Bearer #{cloudflare_token}"
      req["Content-Type"]  = "application/json"
      req.body = body.to_json
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 15, open_timeout: 5) { |h| JSON.parse(h.request(req).body) }
    end
  end
end
