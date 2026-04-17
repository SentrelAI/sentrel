module Email
  # Pushes inbound messages to the engine. Thin wrapper around AgentEventBus.
  module Queue
    module_function

    def enqueue_inbound(agent, conversation, payload)
      AgentEventBus.publish(
        type: "inbound_message",
        agent: agent,
        channel: "email",
        conversation_id: conversation.id,
        payload: payload,
      )
    end
  end
end
