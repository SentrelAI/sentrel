class Api::AgentEventsController < ActionController::API
  before_action :authenticate_engine!

  # POST /api/agent_events
  # Body: { agent_id: N, event: { type: "tool_call", ... } }
  #
  # The engine calls this for every broadcast() — tool_call, tool_result,
  # text_delta, pending_approval, command_approval, media_attachment,
  # progress, done, error. We rebroadcast over AgentChatChannel so the
  # browser sees the agent's live thinking without needing a direct WS
  # into the engine (which sits on Fly's private 6pn network).
  def create
    agent = Agent.find_by(id: params[:agent_id])
    return head :not_found unless agent

    event = params[:event]&.to_unsafe_h
    return head :bad_request unless event.is_a?(Hash) && event[:type].present?

    AgentChatChannel.broadcast_to(agent, event)
    head :ok
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
