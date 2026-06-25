require "net/http"
require "json"

module Nango
  # Thin server-to-server wrapper over our self-hosted Nango instance
  # (services/nango). Authenticates with the Nango Secret Key (Bearer) which
  # lives only in Rails — never the engine, never the browser. The browser only
  # ever receives the short-lived Connect session token minted here.
  #
  # We use only the free self-host Auth + Proxy surface: Connect Sessions (for
  # end-user OAuth) + connection management. The /proxy endpoint lives in
  # Nango::Proxy.
  module Client
    module_function

    class Error < StandardError; end

    def base_url
      ENV.fetch("NANGO_BASE_URL", "http://localhost:3003")
    end

    def secret_key
      ENV["NANGO_SECRET_KEY"].to_s
    end

    def configured?
      secret_key.present?
    end

    # Create a Connect session for an end user to authorize `provider_config_key`.
    # Returns the raw Nango response (most importantly { "token" => ... }) that
    # the frontend hands to @nangohq/frontend to open the Connect UI.
    #
    # byo_overrides (optional) = { oauth_client_id_override:, oauth_client_secret_override: }
    # for bring-your-own OAuth apps; passed as integration config defaults so
    # the OAuth dance runs on the customer's own app, not Sentrel's.
    def create_connect_session(organization:, user:, provider_config_key:, byo_overrides: nil)
      end_user = { id: "org_#{organization.id}", email: user&.email, display_name: user&.name }.compact
      body = {
        end_user: end_user,
        organization: { id: "org_#{organization.id}", display_name: organization.name }.compact,
        allowed_integrations: [ provider_config_key ]
      }
      if byo_overrides.present?
        body[:integrations_config_defaults] = {
          provider_config_key => { connection_config: byo_overrides }
        }
      end
      post_json("/connect/sessions", body)
    end

    # The integrations (provider configs) set up in this Nango environment. Each
    # one's `unique_key` is what we store as provider_config_key. This is the
    # source of truth for "which apps can actually be connected via managed
    # OAuth" — an app in our catalog is only one-click-connectable if its
    # provider_config_key has a matching Nango integration here.
    def list_integrations
      Array(get_json("/integrations")["data"])
    rescue Error
      []
    end

    # Just the configured provider_config_keys, cached briefly so the
    # Integrations page can sync its "available" state without hitting Nango on
    # every render. Empty on failure → the UI degrades gracefully (still shows
    # the catalog; connect attempts surface the "not set up yet" message).
    def configured_provider_keys
      return [] unless configured?
      Rails.cache.fetch("nango:provider_keys", expires_in: 2.minutes) do
        list_integrations.filter_map { |i| i["unique_key"] }
      end
    rescue StandardError
      []
    end

    # Connection details (status, provider, metadata). Used after the callback
    # to confirm the connection is live before we mark the Integration connected.
    def get_connection(connection_id, provider_config_key)
      get_json("/connection/#{connection_id}?provider_config_key=#{provider_config_key}")
    end

    # Revoke + delete a connection when the user disconnects an app.
    def delete_connection(connection_id, provider_config_key)
      request(:delete, "/connection/#{connection_id}?provider_config_key=#{provider_config_key}")
    end

    # ── internals ───────────────────────────────────────────────────────────

    def post_json(path, body)
      res = request(:post, path, body)
      parse(res)
    end

    def get_json(path)
      res = request(:get, path)
      parse(res)
    end

    def request(verb, path, body = nil)
      uri = URI.join(base_url, path)
      klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, delete: Net::HTTP::Delete }.fetch(verb)
      req = klass.new(uri)
      req["Authorization"] = "Bearer #{secret_key}"
      req["Content-Type"]  = "application/json"
      req.body = body.to_json if body
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", open_timeout: 5, read_timeout: 15) do |http|
        http.request(req)
      end
    end

    def parse(res)
      body = JSON.parse(res.body) rescue {}
      unless res.is_a?(Net::HTTPSuccess)
        raise Error, "nango #{res.code}: #{(body["error"] || body["message"] || res.body).to_s[0, 300]}"
      end
      body
    end
  end
end
