require "redis"
require "json"
require "securerandom"

# Single entry point for sending events to agent engines.
# Replaces scattered redis.lpush("agent-inbox-...") call sites with a typed API.
#
# Event types:
#   inbound_message   — message from a channel (email, telegram, whatsapp, web)
#   task_message      — task created, reopened, or commented on
#   schedule_fired    — scheduled_work row triggered (cron or once)
#   heartbeat_tick    — periodic interval check
module AgentEventBus
  INBOX_KEY_PREFIX = "agent-inbox-".freeze

  module_function

  # Publish an event to the agent's engine inbox.
  #
  # @param type [String] one of: inbound_message, task_message, schedule_fired, heartbeat_tick
  # @param agent [Agent] target agent
  # @param payload [Hash] event-specific data (instruction, body, taskId, etc.)
  # @param channel [String, nil] optional channel origin (email, telegram, whatsapp, web)
  # @param conversation_id [Integer, nil] optional conversation this event belongs to
  # @param job_id [String, nil] optional correlation ID. Generated if absent.
  #   Channel handlers that need to route the engine's emitDone back to a
  #   specific caller (e.g. web UI waiting on SSE) should pass one they control.
  def publish(type:, agent:, payload: {}, channel: nil, conversation_id: nil, job_id: nil, user_id: nil, origin: nil)
    job_id ||= SecureRandom.uuid
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    # user_id is the originating human's id (when the inbound came from a
    # logged-in user, a known Telegram chat tied to a user, etc). Engine uses
    # this to pick up the user's private (scope='user') integrations alongside
    # the workspace shared ones.
    enriched_payload = user_id ? payload.merge(metadata: (payload[:metadata] || payload["metadata"] || {}).merge(user_id: user_id)) : payload
    # `origin` captures the channel/route the original user inbound came from
    # so the engine can auto-deliver report-backs to the user's chat without
    # depending on an in-memory listener that may have died on engine restart.
    # Defaulted from channel + conversation_id when not explicitly provided.
    origin ||= if channel.present?
      { channel: channel, conversationId: conversation_id, metadata: {} }
    end
    redis.lpush("#{INBOX_KEY_PREFIX}#{agent.id}", {
      type: type,
      jobId: job_id,
      agentId: agent.id.to_s,
      orgId: agent.organization_id,
      channel: channel,
      conversationId: conversation_id,
      origin: origin,
      payload: enriched_payload
    }.to_json)
    # Scale-to-zero: the event is safely queued in Redis — if the agent's
    # engine is asleep, kick its machine awake to come drain it.
    AgentWaker.wake_async(agent)
    job_id
  rescue => e
    Rails.logger.error "AgentEventBus.publish(#{type}) failed for agent #{agent&.id}: #{e.message}"
    nil
  end
end
