# Connect/manage OAuth-protected external MCP servers (Meta Ads MCP, etc.).
# Mirrors OauthController's PKCE pattern, but the endpoints are *discovered*
# from the MCP server rather than hardcoded — so any MCP works, not just Meta.
class McpServersController < ApplicationController
  # GET /mcp_servers
  def index
    servers = McpServer.where(organization_id: current_tenant.id).order(:name)
    render json: servers.map { |s| serialize(s) }
  end

  # POST /mcp_servers { name, slug, url, client_id }
  # Runs discovery to fill in the authorization-server endpoints + scopes.
  def create
    p = params.permit(:name, :slug, :url, :client_id)
    meta = Mcp::Oauth.discover(p[:url])
    server = McpServer.create!(
      organization_id:    current_tenant.id,
      name:               p[:name],
      slug:               p[:slug].presence || p[:name].to_s.parameterize.underscore,
      url:                p[:url],
      client_id:          p[:client_id],
      scopes:             meta[:scopes],
      issuer:             meta[:issuer],
      authorize_endpoint: meta[:authorize_endpoint],
      token_endpoint:     meta[:token_endpoint],
      status:             "disconnected",
    )
    render json: serialize(server), status: :created
  rescue => e
    render json: { error: "Couldn't set up MCP server: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /mcp_servers/:id/connect → PKCE → redirect to the MCP's consent screen.
  def connect
    server = McpServer.find_by!(id: params[:id], organization_id: current_tenant.id)
    state = SecureRandom.urlsafe_base64(32)
    verifier, challenge = Mcp::Oauth.pkce_pair
    session[:mcp_oauth] = { "server_id" => server.id, "state" => state, "code_verifier" => verifier, "org_id" => current_tenant.id }
    redirect_to Mcp::Oauth.authorize_url(server, redirect_uri: callback_mcp_servers_url, state: state, code_challenge: challenge),
                allow_other_host: true
  end

  # GET /mcp_servers/callback?code=&state= → exchange + persist + sync agents.
  def callback
    pk = session.delete(:mcp_oauth) || {}
    return redirect_to integrations_path, alert: "MCP OAuth state mismatch — reconnect." if pk["state"].blank? || pk["state"] != params[:state]
    return redirect_to integrations_path, alert: "MCP OAuth missing code." if params[:code].blank?
    return redirect_to integrations_path, alert: "MCP OAuth session mismatch." if pk["org_id"].to_i != current_tenant.id

    server = McpServer.find_by!(id: pk["server_id"], organization_id: current_tenant.id)
    tokens = Mcp::Oauth.exchange_code(server, code: params[:code], code_verifier: pk["code_verifier"], redirect_uri: callback_mcp_servers_url)
    Mcp::Oauth.apply_tokens!(server, tokens)
    sync_agents_using(server)
    redirect_to integrations_path, notice: "Connected #{server.name}"
  rescue => e
    Rails.logger.error("MCP OAuth callback failed: #{e.class}: #{e.message}")
    server&.update(status: "error", last_error: e.message.to_s[0, 500])
    redirect_to integrations_path, alert: "MCP connect failed: #{e.message}"
  end

  # DELETE /mcp_servers/:id
  def destroy
    server = McpServer.find_by!(id: params[:id], organization_id: current_tenant.id)
    server.update(status: "disconnected", access_token: nil, refresh_token: nil)
    sync_agents_using(server)
    server.destroy
    head :no_content
  end

  private

  def serialize(s)
    { id: s.id, name: s.name, slug: s.slug, url: s.url, status: s.status,
      scopes: s.scopes, connected: s.connected?, agent_id: s.agent_id }
  end

  # Roll the Fly machines of agents that can see this server so the engine
  # re-reads the connection on its next run.
  def sync_agents_using(server)
    scope = Agent.where(organization_id: server.organization_id)
    scope = scope.where(id: server.agent_id) if server.agent_id
    scope.find_each { |a| EngineSync.trigger(a) rescue nil }
  end
end
