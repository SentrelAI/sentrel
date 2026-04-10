module Email
  # Pushes inbound messages to the engine via Redis.
  module Queue
    module_function

    def enqueue_inbound(agent, conversation, payload)
      redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
      redis.lpush("agent-inbox-#{agent.id}", {
        type: "inbound_message",
        agentId: agent.id.to_s,
        orgId: agent.organization_id,
        channel: "email",
        conversationId: conversation.id,
        payload: payload,
      }.to_json)
    end
  end
end
