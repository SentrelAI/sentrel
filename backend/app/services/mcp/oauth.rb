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
  #   1. discover(url) → { authorize_endpoint, token_endpoint, issuer, scopes }
  #   2. authorize_url(...) → send the user to consent
  #   3. exchange_code(...) → resource-bound access + refresh tokens
  #   4. refresh!(server) → new access token, headless, when one expires
  module Oauth
    module_function

    # RFC 9728: protected-resource metadata lives at
    #   {origin}/.well-known/oauth-protected-resource{path}
    # and names the authorization server(s); RFC 8414 then gives the endpoints.
    def discover(url)
      u = URI(url)
      prm = get_json("#{u.scheme}://#{u.host}/.well-known/oauth-protected-resource#{u.path}")
      auth_server = Array(prm["authorization_servers"]).first || "#{u.scheme}://#{u.host}#{u.path}"
      a = URI(auth_server)
      asm = get_json("#{a.scheme}://#{a.host}/.well-known/oauth-authorization-server#{a.path}")
      {
        issuer:             asm["issuer"],
        authorize_endpoint: asm["authorization_endpoint"],
        token_endpoint:     asm["token_endpoint"],
        scopes:             Array(prm["scopes_supported"]).presence || Array(asm["scopes_supported"]),
        resource:           prm["resource"] || url,
      }
    end

    # PKCE pair — caller stashes verifier in the session, sends challenge here.
    def pkce_pair
      verifier  = SecureRandom.urlsafe_base64(64)
      challenge = Base64.urlsafe_encode64(Digest::SHA256.digest(verifier), padding: false)
      [verifier, challenge]
    end

    def authorize_url(server, redirect_uri:, state:, code_challenge:)
      params = {
        response_type:         "code",
        client_id:             server.client_id,
        redirect_uri:          redirect_uri,
        scope:                 Array(server.scopes).join(" "),
        state:                 state,
        code_challenge:        code_challenge,
        code_challenge_method: "S256",
        resource:              server.url, # RFC 8707 — bind the token to this MCP
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
        resource:      server.url,
      })
    end

    # Headless: trade the refresh token for a fresh access token. Called by the
    # engine's token endpoint when the stored access token is near expiry.
    def refresh!(server)
      raise "no refresh_token stored" if server.refresh_token.blank?
      token_post(server, {
        grant_type:    "refresh_token",
        refresh_token: server.refresh_token,
        client_id:     server.client_id,
        resource:      server.url,
      })
    end

    # Persist a token response onto the server record. Meta returns
    # { access_token, token_type, expires_in, refresh_token? }.
    def apply_tokens!(server, tokens)
      server.access_token  = tokens["access_token"] if tokens["access_token"].present?
      server.refresh_token = tokens["refresh_token"] if tokens["refresh_token"].present?
      if (ttl = tokens["expires_in"]).present?
        server.expires_at = Time.current + ttl.to_i.seconds
      end
      server.status = "connected"
      server.last_error = nil
      server.save!
      server
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
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") { |h| h.request(req) }
      raise "discovery #{res.code} for #{url}" unless res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
    end
  end
end
