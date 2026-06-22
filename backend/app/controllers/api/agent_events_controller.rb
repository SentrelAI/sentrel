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

    AgentChatChannel.broadcast_event(agent, event)

    # When the engine creates a PendingApproval (direct INSERT in the
    # postgres host), it broadcasts a 'pending_approval' event next.
    # Catch it here and post a Block Kit card to Slack — the AR
    # after_commit doesn't fire for direct inserts. ApprovalCard.post is
    # idempotent (it bails when tool_input.slack_card_ts is already set).
    #
    # The engine sends camelCase keys (approvalId) per gateway.ts's emitApproval.
    # We accept both camel- and snake-case so future engine changes don't
    # silently break the integration.
    if event["type"] == "pending_approval"
      approval_id = event["approvalId"] || event["approval_id"] || event.dig("approval", "id")
      if approval_id.present?
        approval = PendingApproval.find_by(id: approval_id)
        Slack::ApprovalCard.post(approval) if approval
      end
    end

    # Mobile push — when the engine finishes a turn it emits a persisted
    # assistant `message` event (see engine/src/agent-runner.ts). Notify the
    # human who started the conversation so they can reopen the chat. The
    # engine writes the row via raw SQL, so this relay is the only Rails-side
    # signal that a reply landed.
    notify_mobile_of_reply(agent, event) if event["type"] == "message" && event["role"] == "assistant"

    head :ok
  end

  private

  # Best-effort: resolve the conversation owner from the event and enqueue a
  # push. Never raises into the relay — a notification failure must not drop
  # the engine's event.
  def notify_mobile_of_reply(agent, event)
    content = event["content"].to_s
    return if content.strip.empty?

    convo_id = event.dig("metadata", "conversation_id") || event["conversation_id"]
    user_id  = convo_id && Conversation.where(id: convo_id).pick(:user_id)
    return unless user_id

    MobilePushJob.perform_later(
      user_ids: [ user_id ],
      title: "#{agent.name} replied",
      body: content,
      data: { type: "agent_reply", agent_id: agent.to_param, conversation_id: convo_id }
    )
  rescue => e
    Rails.logger.warn("[AgentEvents] mobile push failed: #{e.class}: #{e.message}")
  end

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
