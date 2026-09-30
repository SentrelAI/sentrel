# Engine-facing: hands an agent's connected MCP servers to its engine WITH a
# current Bearer token, and takes back what the engine learns when a server
# rejects one. Refresh happens here (server-side), where the refresh tokens
# live — the engine only ever sees a current access token.
#
# OAuth servers are per user: a run acting for a user (user_id — the person
# who sent the message, or who approved the card that resumed the run) gets
# that user's sign-in; a run with no user behind it (schedules, inbound
# email) gets only workspace-level servers, the same rule the Nango
# integrations follow.
class Api::McpServersController < ApplicationController
  skip_before_action :verify_authenticity_token
  before_action :verify_engine_secret!
  before_action :load_agent_and_user

  # GET /api/mcp_servers?agent_id=N[&user_id=M]
  # → { mcp_servers: [{ id, name, label, url, transport, auth_mode, access_token }] }
  #   access_token is null for a public server that takes no auth.
  def index
    servers = McpServer
      .where(organization_id: @agent.organization_id)
      .where("agent_id IS NULL OR agent_id = ?", @agent.id)

    payload = servers.filter_map do |s|
      token = token_for(s)
      next if token == :unavailable
      { id: s.id, name: s.slug, label: s.name, url: s.url, transport: s.transport, auth_mode: s.auth_mode,
        access_token: token }
    end

    render json: { mcp_servers: payload }
  end

  # POST /api/mcp_servers/:id/refresh { agent_id, user_id, rejected_digest }
  # The server answered 401 to the token whose SHA-256 is rejected_digest.
  # → { access_token } — a new one, or the one another run already refreshed
  #   to — or 401 { needs_sign_in: true } when the user has to sign in again.
  def refresh
    connection = oauth_connection or return head :not_found
    token = connection.fresh_access_token!(rejected_digest: params.require(:rejected_digest))
    return render json: { needs_sign_in: true }, status: :unauthorized if token.blank?
    render json: { access_token: token }
  end

  # POST /api/mcp_servers/:id/auth_error { agent_id, user_id, kind, scope? }
  #   kind "unauthorized"       — still 401 after a refresh: sign in again.
  #   kind "insufficient_scope" — 403 naming a scope the token lacks: the
  #                               next sign-in asks for it too.
  def auth_error
    connection = oauth_connection or return head :not_found
    case params.require(:kind)
    when "unauthorized"
      connection.update!(status: "needs_sign_in", last_error: "rejected by the server after a refresh")
    when "insufficient_scope"
      needed = params[:scope].to_s.split
      connection.update!(scopes: connection.scopes | needed, status: "needs_sign_in",
                         last_error: "needs scope #{needed.join(' ')}".first(500))
    else
      return head :bad_request
    end
    head :no_content
  end

  private

  # The user a run acts for, if they belong to the agent's workspace — the
  # engine secret is shared, so a user_id alone isn't trusted.
  def load_agent_and_user
    @agent = Agent.find(params.require(:agent_id))
    @user = params[:user_id].present? ? @agent.organization.members.find_by(id: params[:user_id]) : nil
  end

  # The Bearer token this run should send (nil for a public server), or
  # :unavailable when the server can't be used for it right now.
  def token_for(server)
    case server.auth_mode
    when "none"  then server.status == "connected" ? nil : :unavailable
    when "oauth" then server.connection_for(@user)&.fresh_access_token! || :unavailable
    else              (server.status == "connected" && server.access_token.presence) || :unavailable
    end
  end

  def oauth_connection
    server = McpServer.find_by(id: params[:id], organization_id: @agent.organization_id, auth_mode: "oauth")
    server&.connection_for(@user)
  end

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
