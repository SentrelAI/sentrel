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

    level = params[:level].to_s.presence_in(%w[once session always deny]) || "deny"

    # "always" persists into agent.command_allowlist so the same dangerous
    # command pattern doesn't prompt again. The engine still receives the
    # decision over pubsub so the in-flight call resumes immediately.
    if level == "always" && params[:command].present?
      pattern = params[:command].to_s.split(/\s+/).first.to_s
      if pattern.present?
        list = Array(agent.command_allowlist) + [pattern]
        agent.update!(command_allowlist: list.uniq)
      end
    end

    payload = {
      type: "command_approval_response",
      approvalId: params[:approval_id],
      command: params[:command].to_s,
      level: level,
    }
    receivers = redis.publish("agent-#{agent.id}-approvals", payload.to_json)
    Rails.logger.info "CommandApproval: agent=#{agent.id} approval_id=#{params[:approval_id]} level=#{level} → #{receivers} subscribers"
    head :ok
  end

  private

  def redis
    @redis ||= Redis.new(url: ENV.fetch("REDIS_URL"))
  end
end
