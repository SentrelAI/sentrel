# Engine-facing: hands an agent's connected external MCP servers to its engine
# WITH a fresh Bearer token. Token refresh happens here (server-side), where
# the refresh token + OAuth client live — the engine only ever sees a current
# access token, never the refresh token.
class Api::McpServersController < ApplicationController
  skip_before_action :verify_authenticity_token
  before_action :verify_engine_secret!

  # GET /api/mcp_servers?agent_id=N
  # → [{ name, slug, url, transport, access_token }]  (connected servers only)
  def index
    agent = Agent.find(params.require(:agent_id))

    servers = McpServer
      .where(organization_id: agent.organization_id, status: "connected")
      .where("agent_id IS NULL OR agent_id = ?", agent.id)

    payload = servers.filter_map do |s|
      token = fresh_token(s)
      next if token.blank?
      { name: s.slug, url: s.url, transport: s.transport, access_token: token }
    end

    render json: { mcp_servers: payload }
  end

  private

  # Return a non-expired access token, refreshing transparently if needed.
  def fresh_token(server)
    if server.expired? && server.refresh_token.present?
      begin
        tokens = Mcp::Oauth.refresh!(server)
        Mcp::Oauth.apply_tokens!(server, tokens)
      rescue => e
        Rails.logger.warn("MCP token refresh failed for #{server.slug}: #{e.message}")
        server.update(status: "error", last_error: e.message.to_s[0, 300])
        return nil
      end
    end
    server.access_token
  end

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
