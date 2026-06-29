require "net/http"
require "json"

# Single source of truth for which integrations are usable: returns the static
# IntegrationCatalog (config/integrations.yml) — the list of slugs + display
# labels that can be connected. The engine fetches this at boot + every 30 min
# so propose_connection only ever surfaces Connect cards for things that will
# actually work.
class Api::IntegrationsController < ActionController::API
  before_action :authenticate_engine!

  # GET /api/integrations/supported?organization_id=N
  # The connectable-app catalog the engine advertises for propose_connection.
  # The static IntegrationCatalog (config/integrations.yml) — org_id is accepted
  # for back-compat but unused.
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

    # Dedicated MCP servers (Meta Ads, etc.) are connected apps too, but they
    # live in a separate table. Without surfacing them here, an agent that's
    # ALREADY using the Meta tools still gets "connect Facebook" proposals,
    # because the connected-list it consults didn't know Meta was wired. Add
    # each connected MCP server (+ aliases) so propose_connection + the secrets
    # guard treat them as connected.
    McpServer.where(organization_id: agent.organization_id).select(&:connected?).each do |s|
      mcp_provider_aliases(s).each do |p|
        items << { provider: p, label: s.name, api_base_url: nil, connect_mode: "mcp", tool: "mcp", docs_url: nil }
      end
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

  # A connected MCP server stands in for the provider slug(s) an agent might
  # otherwise try to "connect". Meta's MCP covers the whole Meta family, so a
  # connected Meta server suppresses connect-prompts for facebook/instagram/etc.
  def mcp_provider_aliases(server)
    slugs = [ server.slug ].compact
    blob = [ server.slug, server.name, server.url ].compact.join(" ").downcase
    slugs |= %w[meta_ads facebook instagram meta] if blob.match?(/meta|facebook|instagram/)
    slugs.uniq
  end

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
