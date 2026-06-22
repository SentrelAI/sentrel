# Day-2 ops on an agent's machine from the mobile app. Same AgentMachineOps
# service the web ops controller drives — restart / reload / redeploy /
# reprovision plus a log tail. Org-scoped via the tenant-bound lookup.
class Api::Mobile::Agents::OpsController < Api::Mobile::BaseController
  before_action :load_agent

  def restart
    render_op { AgentMachineOps.restart(@agent) }
  end

  def reload
    render_op { AgentMachineOps.reload(@agent) }
  end

  def redeploy
    render_op { AgentMachineOps.redeploy(@agent, image: params[:image].presence) }
  end

  def reprovision
    render_op { AgentMachineOps.reprovision(@agent) }
  end

  def logs
    lines = params[:lines].to_i.clamp(10, 1000).nonzero? || 200
    render_op { AgentMachineOps.logs(@agent, lines: lines) }
  end

  private

  def load_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  def render_op
    result = yield
    render json: result, status: (result[:ok] ? :ok : :unprocessable_entity)
  rescue => e
    Rails.logger.error("[Mobile::Ops] agent=#{@agent&.id} #{e.class}: #{e.message}")
    render json: { ok: false, message: e.message }, status: :internal_server_error
  end
end
