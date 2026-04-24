class Agents::AiConfigsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_agent

  # PATCH /agents/:agent_id/ai_config
  # Quick model switch from the top-bar dropdown; fully updates the
  # agent's AiConfig, then pushes a sync so the running engine reads
  # the new provider + model_id on its next job (and restarts channel
  # pollers if needed).
  def update
    params = ai_config_params
    config = @agent.ai_config || @agent.build_ai_config
    config.assign_attributes(params)
    config.save!
    EngineSync.trigger(@agent)
    render json: { ok: true, provider: config.provider, model_id: config.model_id }
  rescue ActiveRecord::RecordInvalid => e
    render json: { ok: false, message: e.message }, status: :unprocessable_entity
  end

  private

  def load_agent
    @agent = Agent.find(params[:agent_id])
  rescue ActiveRecord::RecordNotFound
    head :not_found
  end

  def ai_config_params
    params.require(:ai_config).permit(:provider, :model_id, :temperature, :max_tokens, :thinking_level)
  end
end
