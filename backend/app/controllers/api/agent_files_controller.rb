# Engine -> Rails: lists the file-finder files an agent can read (its own
# personal files + the org-shared library). The engine's list_files tool calls
# this; read_file then downloads bytes via /api/blobs/:signed_id.
#
# Auth is the shared engine secret (same as Api::SecretsController). Org scoping
# flows from agent_id -> agent.organization_id; never cross-tenant.
class Api::AgentFilesController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant, raise: false

  before_action :verify_engine_secret!

  # GET /api/agent_files?agent_id=N
  def index
    agent = Agent.find(params.require(:agent_id))
    files = ActsAsTenant.with_tenant(agent.organization) do
      AgentFile.visible_to_agent(agent).with_attached_file.order(created_at: :desc).to_a
    end
    render json: { files: files.map(&:as_engine_json) }
  rescue ActiveRecord::RecordNotFound
    render json: { error: "agent not found" }, status: :not_found
  end

  private

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
