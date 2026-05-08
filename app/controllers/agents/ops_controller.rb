class Agents::OpsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_agent

  def restart
    render_operation { AgentMachineOps.restart(@agent) }
  end

  def reload
    render_operation { AgentMachineOps.reload(@agent) }
  end

  def redeploy
    render_operation { AgentMachineOps.redeploy(@agent, image: params[:image].presence) }
  end

  def reprovision
    render_operation { AgentMachineOps.reprovision(@agent) }
  end

  def logs
    render_operation { AgentMachineOps.logs(@agent, lines: params[:lines].to_i.clamp(10, 1000).nonzero? || 200) }
  end

  private

  def load_agent
    @agent = current_tenant.agents.find(params[:agent_id])
    authorize @agent, :update? if respond_to?(:authorize)
  rescue ActiveRecord::RecordNotFound
    head :not_found
  end

  def render_operation
    render_result(yield)
  rescue => e
    Rails.logger.error "Agents::OpsController failed agent=#{@agent&.id}: #{e.class}: #{e.message}"
    Sentry.capture_exception(e, extra: { agent_id: @agent&.id, controller: self.class.name }) if defined?(Sentry) && Sentry.respond_to?(:capture_exception)
    render json: {
      ok: false,
      message: e.message,
      error_class: e.class.name,
    }, status: :internal_server_error
  end

  def render_result(result)
    status = result[:ok] ? :ok : :unprocessable_entity
    render json: result, status: status
  end
end
