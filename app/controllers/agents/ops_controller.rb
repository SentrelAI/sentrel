class Agents::OpsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_agent

  def restart
    render_result AgentMachineOps.restart(@agent)
  end

  def reload
    render_result AgentMachineOps.reload(@agent)
  end

  def redeploy
    render_result AgentMachineOps.redeploy(@agent, image: params[:image].presence)
  end

  def reprovision
    render_result AgentMachineOps.reprovision(@agent)
  end

  def logs
    result = AgentMachineOps.logs(@agent, lines: params[:lines].to_i.clamp(10, 1000).nonzero? || 200)
    render json: result
  end

  private

  def load_agent
    @agent = Agent.find(params[:agent_id])
    authorize @agent, :update? if respond_to?(:authorize)
  rescue ActiveRecord::RecordNotFound
    head :not_found
  end

  def render_result(result)
    status = result[:ok] ? :ok : :unprocessable_entity
    render json: result, status: status
  end
end
