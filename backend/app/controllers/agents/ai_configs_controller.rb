class Agents::AiConfigsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_agent

  # PATCH /agents/:agent_id/ai_config
  # Quick model switch from the top-bar dropdown. Provider / model_id /
  # thinking_level are baked into the Fly Machine env at provision time
  # (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_DEFAULT_*_MODEL,
  # ENGINE_THINKING_LEVEL) — so switching from anthropic to openrouter
  # needs the machine env repushed, otherwise the engine keeps routing
  # to the original provider. AgentMachineOps.reload PATCHes Fly's env
  # and restarts; for fields that don't affect env (temperature /
  # max_tokens) we just publish on Redis since the engine refreshes
  # agent rows per job anyway.
  def update
    config = @agent.ai_config || @agent.build_ai_config
    config.assign_attributes(ai_config_params)
    env_changed = config.new_record? || AiConfig::ENV_AFFECTING_FIELDS.any? { |f| config.changes.key?(f) }
    config.save!
    reload_result = nil
    if env_changed
      reload_result = begin
        AgentMachineOps.reload(@agent)
      rescue => e
        { ok: false, message: e.message }
      end
    else
      EngineSync.trigger(@agent)
    end
    render json: {
      ok: true, provider: config.provider, model_id: config.model_id,
      # env-affecting switch → the machine restarts with the new brain.
      # Surface whether that actually happened so the UI never implies a
      # change took effect when the machine kept the old env.
      restarting: env_changed,
      machine_ok: reload_result.nil? ? true : !!reload_result[:ok],
      machine_message: reload_result&.dig(:message)
    }
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
