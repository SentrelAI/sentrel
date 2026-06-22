# Chat with an agent from mobile. Same pipeline as the web chat
# (webhooks#web): persist the user's message, publish an inbound_message to the
# engine over AgentEventBus, and let the client poll for the assistant reply.
class Api::Mobile::MessagesController < Api::Mobile::BaseController
  before_action :load_agent

  # GET /api/mobile/agents/:agent_id/messages?limit=50
  def index
    convo = current_internal_conversation
    msgs = if convo
      convo.messages.order(created_at: :asc).last(params[:limit].to_i.clamp(1, 200).nonzero? || 50)
    else
      []
    end
    render json: {
      conversation_id: convo&.id,
      messages: msgs.map { |m| message_json(m) }
    }
  end

  # POST /api/mobile/agents/:agent_id/messages  { body }
  def create
    body = params[:body].to_s
    return render json: { error: "empty_message" }, status: :unprocessable_entity if body.strip.empty?

    cold_start = false
    if @agent.status != "running"
      cold_start = true
      AgentMachineOps.start(@agent) rescue nil
    end

    convo = build_or_extend_conversation
    message = convo.messages.create!(
      role: "user",
      content: body,
      direction: "inbound",
      channel: "web",
      sender_name: current_user.name,
      sender_email: current_user.email,
      sender_user_id: current_user.id,
      metadata: {}
    )

    AgentEventBus.publish(
      type: "inbound_message",
      agent: @agent,
      channel: "web",
      conversation_id: convo.id,
      user_id: current_user.id,
      payload: {
        from: current_user.email,
        from_name: current_user.name,
        body: body,
        conversationId: convo.id,
        user_id: current_user.id
      }
    )

    render json: {
      message: message_json(message),
      conversation_id: convo.id,
      cold_start: cold_start,
      agent_status: @agent.status
    }, status: :created
  end

  # GET /api/mobile/agents/:agent_id/messages/poll?after=ISO8601
  # Returns assistant messages created strictly after `after` (mirror of the
  # web ChatPollsController, but returns all new ones, not just the latest).
  def poll
    after_time = parse_time(params[:after]) || Time.at(0)
    convo = current_internal_conversation

    msgs = if convo
      convo.messages
            .where(role: "assistant")
            .where("created_at > ?", after_time)
            .order(created_at: :asc)
            .select { |m| m.content.to_s.strip.present? }
    else
      []
    end

    render json: { messages: msgs.map { |m| message_json(m) } }
  end

  # POST /api/mobile/agents/:agent_id/messages/read
  # Mark the user's conversation with this agent as read (now). Drives unread
  # badges on the chat list.
  def read
    convo = current_internal_conversation
    convo&.update_column(:last_read_at, Time.current)
    render json: { ok: true }
  end

  private

  def load_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  def current_internal_conversation
    Conversation.find_recent_for_user(
      user_id: current_user.id, agent_id: @agent.id, organization_id: @agent.organization_id
    ) || @agent.conversations.where(kind: "internal", user_id: current_user.id).order(updated_at: :desc).first
  end

  def build_or_extend_conversation
    existing = Conversation.find_recent_for_user(
      user_id: current_user.id, agent_id: @agent.id, organization_id: @agent.organization_id
    )
    return existing if existing && existing.contact_identifier == current_user.email

    @agent.conversations.create!(
      organization: @agent.organization,
      kind: "internal",
      user_id: current_user.id,
      contact_identifier: current_user.email,
      contact_name: current_user.name,
      contact_email: current_user.email,
      status: "active",
      unified_conversation_id: existing&.unified_conversation_id || existing&.id
    )
  end

  def message_json(m)
    {
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at.iso8601,
      metadata: m.metadata,
      sender: m.display_sender
    }
  end

  def parse_time(raw)
    raw.present? ? Time.parse(raw) : nil
  rescue ArgumentError, TypeError
    nil
  end
end
