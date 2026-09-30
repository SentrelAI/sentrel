require "net/http"
require "json"
require "digest"
require "base64"
require "securerandom"

module Mcp
  # Provider-agnostic OAuth for MCP servers that implement the MCP auth spec
  # (RFC 9728 protected-resource metadata + RFC 8414 authorization-server
  # metadata + RFC 8707 resource indicators + PKCE). We never hardcode an
  # endpoint — everything is discovered from the server's well-known docs.
  #
  # Flow:
  #   0. probe(url) → does this server want credentials at all?
  #   1. discover(url) → { authorize_endpoint, token_endpoint, registration_endpoint, issuer, scopes }
  #   2. register_client(...) → a client_id, when the server issues them dynamically
  #   3. authorize_url(...) → send the user to consent
  #   4. exchange_code(...) → resource-bound access + refresh tokens
  #   5. refresh!(server) → new access token, headless, when one expires
  module Oauth
    module_function

    # The server couldn't be reached, or answered like something other than
    # an MCP endpoint. Distinct from a discovery failure, which just means
    # "this server authenticates some other way" (usually a pasted token).
    class Unreachable < StandardError; end

    # One unauthenticated `initialize` tells us what a server needs: 2xx means
    # a public server with no auth at all; 401/403 means it wants a Bearer,
    # and a spec-compliant server names its protected-resource metadata in
    # WWW-Authenticate (RFC 9728 §5.1). Only the status line is read — a
    # streamable-HTTP server may hold the SSE body open. With `token:` it
    # checks a pasted Bearer instead — :required then means it was rejected.
    # → { auth: :none } | { auth: :required, resource_metadata: url_or_nil, scope: str_or_nil }
    def probe(url, transport: "http", token: nil)
      uri = URI(url)
      if transport == "sse"
        req = Net::HTTP::Get.new(uri)
        req["Accept"] = "text/event-stream"
      else
        req = Net::HTTP::Post.new(uri)
        req["Content-Type"] = "application/json"
        req["Accept"] = "application/json, text/event-stream"
        req.body = {
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sentrel", version: "1" } }
        }.to_json
      end
      req["Authorization"] = "Bearer #{token}" if token.present?

      res = nil
      http(uri) do |h|
        catch(:status_read) do
          h.request(req) do |r|
            res = r
            throw :status_read
          end
        end
      end

      case res.code.to_i
      when 200..299 then { auth: :none }
      when 401, 403
        challenge = res["WWW-Authenticate"]
        { auth: :required, resource_metadata: resource_metadata_from(challenge), scope: challenge_param(challenge, "scope") }
      else raise Unreachable, "#{uri.host} answered #{res.code} — that doesn't look like an MCP endpoint"
      end
    rescue Unreachable
      raise
    rescue StandardError => e
      raise Unreachable, "Couldn't reach #{URI(url).host rescue url}: #{e.message}"
    end

    # RFC 9728: protected-resource metadata names the authorization server(s);
    # RFC 8414 then gives the endpoints. Servers disagree on where the docs
    # live, so try, in order: the URL the server's 401 pointed at, the
    # path-suffixed and root well-known locations, and finally (older MCP
    # servers with no resource metadata) the MCP origin as its own auth server.
    # The scope to request is the one the server's 401 challenge named, when it
    # named one; otherwise whatever the metadata says it supports.
    def discover(url, resource_metadata: nil, scope: nil)
      u = URI(url)
      origin = origin_of(u)
      prm = first_json([
        resource_metadata,
        "#{origin}/.well-known/oauth-protected-resource#{u.path}",
        "#{origin}/.well-known/oauth-protected-resource"
      ]) || {}

      auth_server = Array(prm["authorization_servers"]).first || origin
      a = URI(auth_server)
      a_origin = origin_of(a)
      a_path = a.path.to_s.chomp("/")
      asm = first_json([
        "#{a_origin}/.well-known/oauth-authorization-server#{a_path}",
        "#{a_origin}/.well-known/openid-configuration#{a_path}",
        ("#{a_origin}/.well-known/oauth-authorization-server" if a_path.present?)
      ])
      raise "no OAuth metadata for #{url}" unless asm && asm["authorization_endpoint"].present? && asm["token_endpoint"].present?

      {
        issuer:                asm["issuer"],
        authorize_endpoint:    asm["authorization_endpoint"],
        token_endpoint:        asm["token_endpoint"],
        registration_endpoint: asm["registration_endpoint"],
        scopes:                scope.to_s.split.presence || Array(prm["scopes_supported"]).presence || Array(asm["scopes_supported"]),
        resource:              prm["resource"] || url
      }
    end

    # RFC 7591 dynamic client registration. Remote MCPs don't hand out client
    # ids ahead of time — a client registers itself before its first connect.
    # We register as a public client (PKCE, no secret), which is what
    # token_post assumes.
    def register_client(registration_endpoint, redirect_uri:)
      uri = URI(registration_endpoint)
      req = Net::HTTP::Post.new(uri)
      req["Content-Type"] = "application/json"
      req["Accept"] = "application/json"
      req.body = {
        client_name:                "Sentrel",
        redirect_uris:              [ redirect_uri ],
        grant_types:                %w[authorization_code refresh_token],
        response_types:             %w[code],
        token_endpoint_auth_method: "none"
      }.to_json
      res = http(uri) { |h| h.request(req) }
      body = JSON.parse(res.body) rescue {}
      unless res.is_a?(Net::HTTPSuccess) && body["client_id"].present?
        raise "client registration #{res.code}: #{(body["error_description"] || body["error"] || res.body).to_s[0, 300]}"
      end
      body["client_id"]
    end

    # PKCE pair — caller stashes verifier in the session, sends challenge here.
    def pkce_pair
      verifier  = SecureRandom.urlsafe_base64(64)
      challenge = Base64.urlsafe_encode64(Digest::SHA256.digest(verifier), padding: false)
      [ verifier, challenge ]
    end

    # `scopes` defaults to the server's; a re-authorization for more access
    # (403 insufficient_scope) passes the union it needs.
    def authorize_url(server, redirect_uri:, state:, code_challenge:, scopes: server.scopes)
      params = {
        response_type:         "code",
        client_id:             server.client_id,
        redirect_uri:          redirect_uri,
        scope:                 Array(scopes).join(" ").presence,
        state:                 state,
        code_challenge:        code_challenge,
        code_challenge_method: "S256",
        resource:              server.oauth_resource # RFC 8707 — bind the token to this MCP
      }
      "#{server.authorize_endpoint}?#{URI.encode_www_form(params.compact)}"
    end

    def exchange_code(server, code:, code_verifier:, redirect_uri:)
      token_post(server, {
        grant_type:    "authorization_code",
        code:          code,
        redirect_uri:  redirect_uri,
        client_id:     server.client_id,
        code_verifier: code_verifier,
        resource:      server.oauth_resource
      })
    end

    # Headless: trade a refresh token for a fresh access token. Callers must
    # hold the connection's row lock (McpConnection#fresh_access_token!) —
    # refresh tokens rotate, so a concurrent second refresh would fail.
    def refresh!(server, refresh_token:)
      raise "no refresh_token stored" if refresh_token.blank?
      token_post(server, {
        grant_type:    "refresh_token",
        refresh_token: refresh_token,
        client_id:     server.client_id,
        resource:      server.oauth_resource
      })
    end

    # Persist a token response onto the record holding the tokens (an
    # McpConnection). { access_token, token_type, expires_in, refresh_token? }
    # — a rotated refresh token replaces the old one every time.
    def apply_tokens!(record, tokens)
      record.access_token  = tokens["access_token"] if tokens["access_token"].present?
      record.refresh_token = tokens["refresh_token"] if tokens["refresh_token"].present?
      if (ttl = tokens["expires_in"]).present?
        record.expires_at = Time.current + ttl.to_i.seconds
      end
      record.status = "connected"
      record.last_error = nil
      record.save!
      record
    end

    # ── internals ──────────────────────────────────────────────────────────

    def token_post(server, form)
      uri = URI(server.token_endpoint)
      # token_endpoint_auth_method is "none" (public client + PKCE), so no
      # client_secret. If a server ever needs one we'd add it to the form.
      res = Net::HTTP.post_form(uri, form.compact.transform_keys(&:to_s))
      body = JSON.parse(res.body) rescue {}
      unless res.is_a?(Net::HTTPSuccess) && body["access_token"].present?
        raise "token endpoint #{res.code}: #{(body["error_description"] || body["error"] || res.body).to_s[0, 300]}"
      end
      body
    end

    def get_json(url)
      uri = URI(url)
      req = Net::HTTP::Get.new(uri)
      req["Accept"] = "application/json"
      res = http(uri) { |h| h.request(req) }
      raise "discovery #{res.code} for #{url}" unless res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
    end

    # The first candidate URL that serves a JSON object, or nil.
    def first_json(urls)
      urls.compact.uniq.each do |url|
        json = get_json(url) rescue nil
        return json if json.is_a?(Hash)
      end
      nil
    end

    # `Bearer realm="OAuth", resource_metadata="https://…"` → the URL.
    def resource_metadata_from(header)
      challenge_param(header, "resource_metadata")
    end

    # One quoted auth-param from a WWW-Authenticate challenge, e.g. scope.
    def challenge_param(header, name)
      header.to_s[/(?:\A|[\s,])#{Regexp.escape(name)}="([^"]*)"/, 1].presence
    end

    def origin_of(uri)
      port = uri.port == uri.default_port ? "" : ":#{uri.port}"
      "#{uri.scheme}://#{uri.host}#{port}"
    end

    def http(uri, &block)
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https",
                      open_timeout: 5, read_timeout: 10, &block)
    end
  end
end
