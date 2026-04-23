class Api::CommandApprovalsController < ApplicationController
  # Authenticated via Devise + Pundit (same as any org-scoped action).
  # No skip_before_action :verify_authenticity_token needed — JSON POSTs
  # from our own Inertia frontend carry the CSRF token.
  before_action :authenticate_user!

  # POST /api/command_approvals
  # Body: { agent_id: N, approval_id: "...", command: "...", level: "once"|"session"|"deny" }
  #
  # Relays a command-approval response from the user to the engine Machine
  # via Redis pub/sub (Rails and the engine both speak to the same Valkey).
  # Engine subscribes to agent-<id>-approvals in gateway.ts.
  def create
    agent = Agent.find_by(id: params[:agent_id])
    return head :not_found unless agent
    return head :forbidden unless current_user.organization_id == agent.organization_id

    payload = {
      type: "command_approval_response",
      approvalId: params[:approval_id],
      command: params[:command].to_s,
      level: params[:level].to_s.presence_in(%w[once session deny]) || "deny",
    }
    redis.publish("agent-#{agent.id}-approvals", payload.to_json)
    head :ok
  end

  private

  def redis
    @redis ||= Redis.new(url: ENV.fetch("REDIS_URL"))
  end
end
