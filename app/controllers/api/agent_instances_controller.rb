# Engine → Rails callback. Called by cloud-init.sh after docker compose
# brings up the agent's containers and /health returns 200.
#
# Rails uses this to flip the instance from "provisioning" → "running" and
# record the public IP so the admin UI can show a green dot.
class Api::AgentInstancesController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!

  # POST /api/agent_instances/ready
  # Body: { employee_id: N, public_ip: "1.2.3.4" }
  def ready
    agent = Agent.find_by(id: params[:employee_id])
    return head :not_found unless agent
    instance = agent.instance
    return head :not_found unless instance

    instance.update!(
      status: "running",
      public_ip: params[:public_ip].presence || instance.public_ip,
      health_checked_at: Time.current,
      started_at: instance.started_at || Time.current,
    )
    Rails.logger.info "Agent #{agent.id} instance ready: #{instance.public_ip}"
    head :ok
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
