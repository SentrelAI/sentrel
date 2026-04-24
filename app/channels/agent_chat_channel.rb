class AgentChatChannel < ApplicationCable::Channel
  def subscribed
    # Frontend may pass either the numeric id or the public prefix_id
    # (agt_...). prefixed_ids gem monkey-patches Agent.find to accept both.
    raw = params[:agent_id].to_s
    agent = Agent.find(raw) rescue nil
    unless agent
      Rails.logger.warn("[AgentChatChannel] rejected: no agent id=#{raw.inspect}")
      return reject
    end
    unless current_user&.organization_id == agent.organization_id
      Rails.logger.warn("[AgentChatChannel] rejected: user #{current_user&.id} org #{current_user&.organization_id} != agent.org #{agent.organization_id}")
      return reject
    end

    stream = self.class.stream_name_for(agent)
    Rails.logger.info("[AgentChatChannel] user=#{current_user.id} subscribed to #{stream}")
    stream_from stream
  end

  def unsubscribed
  end

  def self.stream_name_for(agent)
    "agent_chat:#{agent.id}"
  end

  def self.broadcast_event(agent, event)
    stream = stream_name_for(agent)
    Rails.logger.info("[AgentChatChannel] broadcast #{event[:type] || event['type']} to #{stream}")
    ActionCable.server.broadcast(stream, event)
  end

  def self.broadcast_assistant_message(agent, message)
    broadcast_event(agent, {
      type: "message",
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.created_at.iso8601,
      metadata: message.metadata,
    })
  end
end
