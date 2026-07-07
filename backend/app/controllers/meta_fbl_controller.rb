# Facebook Login for Business (FLB) — the one-click "Connect Meta" flow.
#
# start:    sends the signed-in user to Meta's business consent screen for our
#           FLB configuration (token type: System User). Mirrors the state
#           pattern of SlackOauthController.
# callback: verifies state, exchanges the code for a Business Integration
#           System User (BISU) token, and persists it on the org's `meta_ads`
#           McpServer row — the same row the engine's mcp__meta_ads__* tools
#           read their Bearer token from. Re-connecting refreshes the token in
#           place; nothing else about the MCP wiring changes.
#
# Gated by Meta::FacebookLogin.enabled? (META_FBL_ENABLED) — until App Review
# grants Advanced Access, only users with a role on the Meta app (admins /
# developers / testers) can complete the consent, which is exactly what we
# need for screencasts + our own reconnect.
class MetaFblController < ApplicationController
  META_SLUG = "meta_ads".freeze

  # GET /meta/fbl/start
  def start
    unless Meta::FacebookLogin.enabled?
      return redirect_to integrations_path, alert: "Meta one-click connect isn't enabled yet — use the token connect."
    end
    state = SecureRandom.urlsafe_base64(32)
    session[:meta_fbl] = { "state" => state, "org_id" => current_tenant.id }
    redirect_to Meta::FacebookLogin.authorize_url(redirect_uri: meta_fbl_callback_url, state: state),
                allow_other_host: true
  end

  # GET /meta/fbl/callback
  def callback
    saved = session.delete(:meta_fbl) || {}

    if params[:error].present?
      return redirect_to integrations_path,
        alert: "Meta connect was cancelled: #{params[:error_description].presence || params[:error]}"
    end
    unless params[:state].present? && saved["state"].present? &&
           ActiveSupport::SecurityUtils.secure_compare(params[:state].to_s, saved["state"].to_s)
      return redirect_to integrations_path, alert: "Meta connect failed (state mismatch) — please try again."
    end
    unless saved["org_id"] == current_tenant.id
      return redirect_to integrations_path, alert: "Meta connect failed (workspace changed mid-flow) — please try again."
    end

    token = Meta::FacebookLogin.exchange_code(code: params[:code], redirect_uri: meta_fbl_callback_url)
    expires_at = resolve_expiry(token)

    server = McpServer.find_or_initialize_by(organization_id: current_tenant.id, slug: META_SLUG)
    server.assign_attributes(
      name:         server.name.presence || "Meta Ads",
      url:          server.url.presence || Meta::FacebookLogin.default_mcp_url,
      transport:    server.transport.presence || "http",
      access_token: token[:access_token],
      expires_at:   expires_at,
      status:       "connected",
    )
    server.save!
    sync_agents_using(server)

    redirect_to integrations_path, notice: "Meta connected — ads tools are live for this workspace."
  rescue Meta::FacebookLogin::Error => e
    redirect_to integrations_path, alert: "Meta connect failed: #{e.message}"
  end

  private

  # The code exchange usually returns expires_in; when it doesn't (some BISU
  # responses omit it), ask the debug endpoint for the token's real expiry so
  # the refresh job knows when to act. nil = treat as non-expiring until a 401.
  def resolve_expiry(token)
    return Time.current + token[:expires_in].to_i.seconds if token[:expires_in].present?
    debug = Meta::FacebookLogin.debug_token(token[:access_token])
    exp = debug.dig("data", "expires_at").to_i
    exp.positive? ? Time.zone.at(exp) : nil
  rescue Meta::FacebookLogin::Error
    nil
  end

  # Same wake-up the MCP connect flow does: agents using this server re-read
  # their connections.
  def sync_agents_using(server)
    scope = Agent.where(organization_id: server.organization_id)
    scope = scope.where(id: server.agent_id) if server.agent_id
    scope.find_each { |a| EngineSync.trigger(a) rescue nil }
  end
end
