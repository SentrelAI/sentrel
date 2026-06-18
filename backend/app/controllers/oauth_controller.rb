require "net/http"
require "uri"
require "securerandom"
require "base64"
require "digest"

# OAuth flows for AI provider subscriptions (Anthropic Pro/Max/Team, ChatGPT
# Plus/Pro/Business). PKCE + OAuth 2.0 self-identifying client (the client_id
# is the URL of a published metadata document we host).
#
# claude.ai/oauth/authorize accepts any URL as client_id as long as that URL
# returns valid OAuth client metadata (RFC 7591-ish). We host our own at
# /oauth/anthropic/client-metadata, so we don't need a registered client_id
# from Anthropic. Same pattern for OpenAI.
#
# Engine-side billing proxy still injects the Claude Code identifier header so
# the resulting OAuth token routes to the user's subscription pool.
class OauthController < ApplicationController
  # client metadata + callback are public (Anthropic's authorize redirect can't
  # carry our session). connect/disconnect remain user-gated.
  before_action :authenticate_user!, except: [ :anthropic_client_metadata, :openai_client_metadata, :callback ]

  # OAuth client metadata documents. The URL of each is the client_id we use
  # in the OAuth authorize call — the self-identifying-client pattern.
  def anthropic_client_metadata
    base = oauth_base_url
    render json: {
      client_id: "#{base}/oauth/anthropic/client-metadata",
      client_name: "Sentrel",
      client_uri: base,
      redirect_uris: [ "#{base}/oauth/anthropic/callback" ],
      grant_types: [ "authorization_code", "refresh_token" ],
      response_types: [ "code" ],
      token_endpoint_auth_method: "none"
    }
  end

  def openai_client_metadata
    base = oauth_base_url
    render json: {
      client_id: "#{base}/oauth/openai/client-metadata",
      client_name: "Sentrel",
      client_uri: base,
      redirect_uris: [ "#{base}/oauth/openai/callback" ],
      grant_types: [ "authorization_code", "refresh_token" ],
      response_types: [ "code" ],
      token_endpoint_auth_method: "none"
    }
  end

  # POST /oauth/anthropic/import_token — accepts the JSON blob from
  # ~/.claude/.credentials.json (or the raw access_token) the user copied
  # after running `claude /login` locally. Stores it in oauth_credentials
  # exactly as if the OAuth flow had completed. Refresh job picks it up.
  #
  # This is the practical path since claude.ai/oauth/authorize requires a
  # registered UUID client_id we don't own; the user does the OAuth dance
  # in the official CLI and just hands us the resulting token.
  def import_token
    raw = params[:credentials].to_s.strip
    raise "Empty credentials" if raw.empty?

    parsed = begin
      json = JSON.parse(raw)
      json["claudeAiOauth"] || json
    rescue JSON::ParserError
      { "accessToken" => raw }
    end

    access = sanitize_token_value(parsed["accessToken"] || parsed["access_token"])
    raise "No accessToken in supplied JSON" if access.blank?

    cred = OauthCredential.find_or_initialize_by(
      organization_id: current_user.organization_id,
      provider: "anthropic",
    )
    cred.kind             = "ai_provider"
    cred.access_token     = access
    cred.refresh_token    = sanitize_token_value(parsed["refreshToken"] || parsed["refresh_token"])
    if parsed["expiresAt"].present?
      cred.expires_at = Time.zone.at(parsed["expiresAt"].to_i / 1000)
    elsif parsed["expires_at"].present?
      cred.expires_at = Time.zone.at(parsed["expires_at"].to_i)
    elsif access.start_with?("sk-ant-oat01-")
      # `claude setup-token` mints a 1-year, non-refreshable bearer. The
      # exact expiry is opaque (Anthropic doesn't return one); 1y from now
      # is the correct user-facing approximation. Refresh job skips these
      # automatically since refresh_token is blank.
      cred.expires_at = 1.year.from_now
    end
    cred.scope = (parsed["scopes"] || parsed["scope"]).is_a?(Array) ? parsed["scopes"].join(" ") : parsed["scope"]
    cred.account_email = parsed["email"] || "Claude Code OAuth"
    cred.last_refreshed_at = Time.current
    cred.save!

    Agent
      .where(organization_id: current_user.organization_id)
      .find_each do |agent|
        next unless agent.ai_config&.provider == "anthropic_account"
        AgentMachineOps.reload(agent) rescue nil
      end

    redirect_to integrations_path, notice: "Claude Code token imported"
  rescue => e
    redirect_to integrations_path, alert: "Token import failed: #{e.message}"
  end

  # GET /oauth/:provider/connect → redirect user to provider's authorize URL.
  def connect
    provider = sanitize_provider(params[:provider])
    state = SecureRandom.urlsafe_base64(32)
    code_verifier = SecureRandom.urlsafe_base64(64)
    code_challenge = Base64.urlsafe_encode64(Digest::SHA256.digest(code_verifier), padding: false)

    session[:oauth_pkce] = {
      "provider"      => provider,
      "state"         => state,
      "code_verifier" => code_verifier,
      "org_id"        => current_user.organization_id
    }

    redirect_to authorize_url(provider, state: state, code_challenge: code_challenge), allow_other_host: true
  end

  # GET /oauth/:provider/callback?code=...&state=... → exchange + persist.
  def callback
    provider = sanitize_provider(params[:provider])
    pkce = session.delete(:oauth_pkce) || {}

    if pkce["state"].blank? || pkce["state"] != params[:state]
      redirect_to integrations_path, alert: "OAuth state mismatch — try connecting again." and return
    end
    if params[:code].blank?
      redirect_to integrations_path, alert: "OAuth callback missing authorization code." and return
    end
    if pkce["org_id"].to_i != current_user.organization_id
      redirect_to integrations_path, alert: "OAuth session mismatch." and return
    end

    tokens = exchange_code(provider, code: params[:code], code_verifier: pkce["code_verifier"])
    persist_credential!(provider, tokens)

    # Push the new token into every Fly Machine for agents using this provider.
    Agent
      .where(organization_id: current_user.organization_id)
      .where("ai_config_id IS NOT NULL")
      .find_each do |agent|
        next unless agent.ai_config&.provider == "#{provider}_account"
        AgentMachineOps.reload(agent) rescue nil
      end

    redirect_to integrations_path, notice: "Connected #{provider.titleize} account"
  rescue => e
    Rails.logger.error("OAuth callback (#{provider}) failed: #{e.class}: #{e.message}")
    redirect_to integrations_path, alert: "OAuth failed: #{e.message}"
  end

  # DELETE /oauth/:provider/disconnect — remove the credential and roll any
  # agents currently using it so the next run doesn't 401.
  def disconnect
    provider = sanitize_provider(params[:provider])
    cred = OauthCredential.find_by(organization_id: current_user.organization_id, provider: provider, kind: "ai_provider")
    cred&.destroy

    # Reload affected agents — they'll fall back to the default provider env.
    Agent
      .where(organization_id: current_user.organization_id)
      .find_each do |agent|
        next unless agent.ai_config&.provider == "#{provider}_account"
        AgentMachineOps.reload(agent) rescue nil
      end

    redirect_to integrations_path, notice: "Disconnected #{provider.titleize} account"
  end

  private

  def sanitize_provider(p)
    raise ArgumentError, "unsupported provider" unless OauthCredential::PROVIDERS.include?(p.to_s)
    p.to_s
  end

  def sanitize_token_value(value)
    return nil if value.nil?

    value.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").gsub(/[[:space:]]+/, "")
  end

  def authorize_url(provider, state:, code_challenge:)
    case provider
    when "anthropic"
      # Anthropic accepts the OAuth 2.0 self-identifying client pattern:
      # the URL of our hosted metadata document IS the client_id. Anthropic
      # fetches that URL out-of-band to validate, so WEBHOOK_BASE_URL must
      # be publicly reachable (won't work from localhost).
      params = {
        client_id: client_metadata_url(provider),
        response_type: "code",
        redirect_uri: callback_url(provider),
        scope: "org:create_api_key user:profile user:inference",
        code_challenge: code_challenge,
        code_challenge_method: "S256",
        state: state
      }
      "https://claude.ai/oauth/authorize?#{params.to_query}"
    when "openai"
      # OpenAI's auth.openai.com rejects URL-shaped client_ids ("expected
      # UUID, found 'h'"). They only accept a UUID registered via their
      # Developer App console. Fall back to an env-var-supplied client_id.
      cid = ENV["OPENAI_OAUTH_CLIENT_ID"].presence
      raise "OpenAI OAuth requires OPENAI_OAUTH_CLIENT_ID env var to be set with a UUID client_id (auth.openai.com doesn't accept URL client_ids)." if cid.blank?
      params = {
        client_id: cid,
        response_type: "code",
        redirect_uri: callback_url(provider),
        scope: "openid profile email offline_access",
        code_challenge: code_challenge,
        code_challenge_method: "S256",
        state: state
      }
      "https://auth.openai.com/oauth/authorize?#{params.to_query}"
    end
  end

  def client_metadata_url(provider)
    "#{oauth_base_url}/oauth/#{provider}/client-metadata"
  end

  def callback_url(provider)
    "#{oauth_base_url}/oauth/#{provider}/callback"
  end

  def oauth_base_url
    ENV.fetch("WEBHOOK_BASE_URL", "http://localhost:3000")
  end

  def exchange_code(provider, code:, code_verifier:)
    case provider
    when "anthropic"
      post_json("https://console.anthropic.com/v1/oauth/token", {
        grant_type: "authorization_code",
        code: code,
        client_id: client_metadata_url("anthropic"),
        redirect_uri: callback_url("anthropic"),
        code_verifier: code_verifier
      })
    when "openai"
      post_json("https://auth.openai.com/oauth/token", {
        grant_type: "authorization_code",
        code: code,
        client_id: ENV.fetch("OPENAI_OAUTH_CLIENT_ID", ""),
        redirect_uri: callback_url("openai"),
        code_verifier: code_verifier
      })
    end
  end

  def post_json(url, body)
    uri = URI.parse(url)
    req = Net::HTTP::Post.new(uri)
    req["Content-Type"] = "application/json"
    req["Accept"] = "application/json"
    req.body = body.to_json
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30, open_timeout: 5) { |http| http.request(req) }
    raise "token endpoint #{res.code}: #{res.body.to_s[0..300]}" unless res.is_a?(Net::HTTPSuccess)
    JSON.parse(res.body)
  end

  def persist_credential!(provider, tokens)
    ActsAsTenant.with_tenant(current_user.organization) do
      cred = OauthCredential.find_or_initialize_by(organization_id: current_user.organization_id, provider: provider)
      cred.kind             = "ai_provider"
      cred.access_token     = tokens["access_token"]
      cred.refresh_token    = tokens["refresh_token"] if tokens["refresh_token"].present?
      if tokens["expires_in"].present?
        cred.expires_at = Time.current + tokens["expires_in"].to_i.seconds
      elsif tokens["expires_at"].present?
        cred.expires_at = Time.zone.at(tokens["expires_at"].to_i)
      end
      cred.scope         = tokens["scope"] if tokens["scope"].present?
      cred.account_email = tokens["email"] || tokens.dig("account", "email")
      cred.account_id    = tokens["account_id"] || tokens.dig("account", "id") || tokens.dig("account", "uuid")
      cred.last_refreshed_at = Time.current
      cred.save!
    end
  end
end
