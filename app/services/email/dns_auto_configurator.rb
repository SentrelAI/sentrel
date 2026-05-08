require "net/http"

module Email
  # Auto-configures the SES DNS records for an email domain when the
  # domain falls under a zone we manage. Routes to a provider-specific
  # backend (Cloudflare or AWS Route 53) so customers can either bring
  # their own domain or claim a managed subdomain like `acme.double.md`
  # and we provision everything for them.
  #
  # Env: MANAGED_DNS_ZONES is a comma-separated list. Entries can be:
  #   - "double.md"                 → defaults to cloudflare
  #   - "route53:double.md"         → managed via Route 53
  #   - "cloudflare:scribemd.ai"    → managed via Cloudflare (explicit)
  #
  # Provider creds:
  #   Cloudflare: CLOUDFLARE_API_KEY (Bearer token w/ Zone:DNS:Edit)
  #   Route 53:   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (route53:* perms)
  #
  # Behaviour:
  #   .managed?(domain)             — does this domain fall under a zone?
  #   .managed_zone_for(domain)     — which zone (or nil)?
  #   .apply!(domain, records)      — idempotently create each record on the
  #                                    appropriate provider; returns
  #                                    { applied:, skipped:, errors:, zone:, provider: }
  module DnsAutoConfigurator
    module_function

    # Returns the parent managed zone for `domain` if any, else nil.
    def managed_zone_for(domain)
      managed_zone_entry_for(domain)&.first
    end

    def managed_provider_for(domain)
      managed_zone_entry_for(domain)&.last
    end

    def managed?(domain)
      !managed_zone_entry_for(domain).nil?
    end

    # Suggested subdomain for an org under one of our managed zones —
    # `<slug>.<zone>`. Picks the first zone configured. Returns nil when no
    # zone is managed.
    def suggested_subdomain_for(slug)
      sanitized = slug.to_s.downcase.gsub(/[^a-z0-9-]/, "-").gsub(/-+/, "-").gsub(/\A-|-\z/, "")
      return nil if sanitized.blank?
      zone = managed_zones.first
      zone ? "#{sanitized}.#{zone}" : nil
    end

    def managed_zones
      parsed_managed_zones.map { |zone, _provider| zone }
    end

    # Returns [{zone:, provider:}] for the UI to render available options.
    def available_zones
      parsed_managed_zones.map { |zone, provider| { zone: zone, provider: provider } }
    end

    def apply!(domain, records)
      entry = managed_zone_entry_for(domain)
      raise "Domain #{domain} is not in a managed zone (#{managed_zones.join(', ')})" unless entry

      zone, provider = entry
      result = case provider
               when "cloudflare" then CloudflareProvider.apply!(zone, records)
               when "route53"    then Route53Provider.apply!(zone, records)
               else raise "Unknown DNS provider #{provider} for zone #{zone}"
               end

      result.merge(zone: zone, provider: provider)
    end

    # ── internals ──────────────────────────────────────────────────────────

    def managed_zone_entry_for(domain)
      parsed_managed_zones.find { |zone, _| domain == zone || domain.end_with?(".#{zone}") }
    end

    # Parses MANAGED_DNS_ZONES into [[zone, provider], ...]. Default provider
    # for unprefixed entries is "cloudflare" (backward compat with the
    # original one-string format). When the env is empty, we default to
    # route53:double.md — our primary managed zone — so a fresh deploy has
    # auto-DNS working without any extra configuration.
    DEFAULT_MANAGED_ZONES = [["double.md", "route53"]].freeze

    def parsed_managed_zones
      raw_env = ENV.fetch("MANAGED_DNS_ZONES", "")
      return DEFAULT_MANAGED_ZONES if raw_env.strip.empty?

      raw_env.split(",").filter_map do |raw|
        entry = raw.strip
        next if entry.empty?
        if entry.include?(":")
          provider, zone = entry.split(":", 2).map(&:strip)
          [zone, provider.downcase] if provider.present? && zone.present?
        else
          [entry, "cloudflare"]
        end
      end
    end

    # ── Cloudflare backend ────────────────────────────────────────────────
    module CloudflareProvider
      module_function

      CF_API = "https://api.cloudflare.com/client/v4".freeze

      def apply!(zone, records)
        zone_id = zone_id_for(zone)
        raise "Cloudflare zone #{zone} not found" unless zone_id

        applied = []
        skipped = []
        errors  = []

        records.each do |rec|
          type    = rec[:type] || rec["type"]
          name    = rec[:name] || rec["name"]
          value   = rec[:value] || rec["value"]
          purpose = rec[:purpose] || rec["purpose"]

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

        { applied:, skipped:, errors: }
      end

      def cloudflare_token
        ENV["CLOUDFLARE_API_KEY"].to_s
      end

      def zone_id_for(zone)
        cf_get("/zones?name=#{zone}").dig("result", 0, "id")
      end

      def find_record(zone_id, type:, name:)
        Array(cf_get("/zones/#{zone_id}/dns_records?type=#{type}&name=#{name}")["result"])
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

    # ── Route 53 backend ──────────────────────────────────────────────────
    module Route53Provider
      module_function

      def apply!(zone, records)
        client = ::Aws::Route53::Client.new
        hosted_zone_id = hosted_zone_id_for(client, zone)
        raise "Route53 hosted zone #{zone} not found" unless hosted_zone_id

        applied = []
        skipped = []
        errors  = []

        records.each do |rec|
          type    = rec[:type] || rec["type"]
          name    = rec[:name] || rec["name"]
          value   = rec[:value] || rec["value"]
          purpose = rec[:purpose] || rec["purpose"]

          # Route 53 wants TXT values quoted; CNAME values fine as-is.
          # MX values are "<priority> <host>", same as our build_dns_records output.
          rr_value = type == "TXT" ? %("#{value.gsub('"', '\\"')}") : value

          fqdn = name.end_with?(".") ? name : "#{name}."
          existing = client.list_resource_record_sets(
            hosted_zone_id: hosted_zone_id,
            start_record_name: fqdn,
            start_record_type: type,
            max_items: 1,
          ).resource_record_sets.first

          if existing && existing.name == fqdn && existing.type == type &&
             existing.resource_records.any? { |r| r.value == rr_value }
            skipped << { type:, name:, purpose:, reason: "already present" }
            next
          end

          begin
            client.change_resource_record_sets(
              hosted_zone_id: hosted_zone_id,
              change_batch: {
                changes: [{
                  action: "UPSERT",
                  resource_record_set: {
                    name: fqdn,
                    type: type,
                    ttl: 300,
                    resource_records: [{ value: rr_value }],
                  },
                }],
              },
            )
            applied << { type:, name:, purpose: }
          rescue ::Aws::Route53::Errors::ServiceError => e
            errors << { type:, name:, purpose:, error: e.message }
          end
        end

        { applied:, skipped:, errors: }
      end

      def hosted_zone_id_for(client, zone)
        # ListHostedZonesByName matches by prefix; check the exact match.
        target = zone.end_with?(".") ? zone : "#{zone}."
        list = client.list_hosted_zones_by_name(dns_name: target, max_items: 5)
        match = list.hosted_zones.find { |hz| hz.name == target }
        match&.id&.split("/")&.last
      rescue ::Aws::Route53::Errors::ServiceError
        nil
      end
    end
  end
end
