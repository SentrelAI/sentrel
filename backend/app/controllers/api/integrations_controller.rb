require "net/http"
require "json"

# Single source of truth for which integrations are usable: queries Composio's
# /api/v3/auth_configs and returns the list of toolkit slugs + display labels
# that have an auth_config wired up. The engine fetches this at boot + every
# 30 min so propose_connection only ever surfaces Connect cards for things
# that will actually work.
class Api::IntegrationsController < ActionController::API
  before_action :authenticate_engine!

  # GET /api/integrations/supported?organization_id=N
  # The connectable-app catalog the engine advertises for propose_connection.
  # Now the static IntegrationCatalog (config/integrations.yml), not a live
  # Composio fetch — org_id is accepted for back-compat but unused.
  def supported
    render json: { items: IntegrationCatalog.list_for_engine }
  rescue => e
    Rails.logger.warn "GET /api/integrations/supported failed: #{e.class}: #{e.message}"
    render json: { items: [], error: e.message }, status: :ok # don't break engine boot
  end

  # GET /api/integrations?agent_id=N[&user_id=M]
  # The agent's CONNECTED providers, so the engine knows which apps nango_request
  # can target + where to route them (api_base_url) + how they're connected.
  # Tokens never leave Rails — the engine round-trips calls through #proxy.
  def connected
    agent = Agent.find(params[:agent_id])
    rows = Integration.where(organization_id: agent.organization_id, status: "connected")
    rows = rows.where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", params[:user_id]) if params[:user_id].present?
    rows = rows.where(scope: "org") unless params[:user_id].present?

    items = rows.filter_map do |row|
      entry = IntegrationCatalog.find(row.service_name) or next
      {
        provider: row.service_name,
        label: entry[:label],
        api_base_url: entry[:api_base_url],
        connect_mode: row.connect_mode,
        tool: entry[:tool],         # "proxy" → nango_request ; "mcp" → dedicated MCP
        docs_url: entry[:docs_url]
      }
    end
    render json: { integrations: items }
  rescue ActiveRecord::RecordNotFound
    render json: { integrations: [], error: "agent not found" }, status: :ok
  end

  # POST /api/nango_proxy
  # Body: { agent_id, provider, method, path, query?, body?, approved? }
  # The engine's nango_request tool hits this; we resolve the connection,
  # enforce ACL + the approval gate, and proxy through Nango (or the pasted
  # token for byo_token providers).
  def proxy
    agent = Agent.find(params[:agent_id])
    # Find the connection, preferring "connected" but accepting "error" too — a
    # flagged-but-maybe-recovered connection should still get a call attempt
    # (it either works, or 401s → AuthExpired). Only a genuinely absent /
    # disconnected row is "not connected".
    integration = Integration
      .where(organization_id: agent.organization_id, service_name: params[:provider].to_s)
      .where(status: %w[connected error])
      .order(Arel.sql("CASE status WHEN 'connected' THEN 0 ELSE 1 END"))
      .first
    return render(json: { error: "#{params[:provider]} is not connected", needs_connection: true }, status: :not_found) unless integration

    result = Nango::Proxy.call(
      agent: agent, integration: integration,
      method: params[:method].to_s.presence || "GET",
      path: params[:path].to_s,
      query: params[:query]&.to_unsafe_h || {},
      body: params[:body],
      approved: ActiveModel::Type::Boolean.new.cast(params[:approved]),
    )
    render json: { status: result.status, body: result.body, source: result.source }
  rescue ActiveRecord::RecordNotFound
    render json: { error: "agent not found" }, status: :not_found
  rescue Nango::Proxy::ApprovalRequired
    render json: { error: "approval required", requires_approval: true }, status: :accepted
  rescue Nango::Proxy::Forbidden => e
    render json: { error: e.message, forbidden: true }, status: :forbidden
  rescue Nango::Proxy::RateLimited => e
    # Distinct from a hard failure — the connection is fine, just throttled.
    render json: { error: e.message, rate_limited: true, retry_after: e.retry_after }, status: :too_many_requests
  rescue Nango::Proxy::Transient => e
    # Momentary infra blip that survived retries — NOT a disconnect. Tell the
    # agent to try again shortly, not to reconnect.
    render json: { error: e.message, transient: true }, status: :service_unavailable
  rescue Nango::Proxy::AuthExpired => e
    # Token is dead (revoked / refresh failed). The connection is genuinely
    # broken — the user must reconnect.
    render json: { error: e.message, needs_reconnect: true }, status: :unauthorized
  rescue => e
    Rails.logger.warn "POST /api/nango_proxy failed: #{e.class}: #{e.message}"
    render json: { error: e.message }, status: :bad_gateway
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
