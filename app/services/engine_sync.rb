# Tells a running agent engine to reload its filesystem-projected state
# (soul.md, skills/, channel handlers). Per-job state — capabilities,
# identity prose, ai_config, command_allowlist — already syncs because
# the engine refreshes the agent row on every job in main.ts.
#
# Call this AFTER persisting changes to:
#   - agent identity / personality / instructions / memory text
#   - agent_skills (toggle, install, uninstall)
#   - channel_configs (token rotation, new bot number, enable/disable)
#
# Transport: Redis pub/sub on agent-<id>-sync. The engine listens in
# subscribeSyncChannel() and runs the same flow as the HTTP POST /sync
# endpoint (reload config + restart Telegram/WhatsApp pollers). This
# works across Fly's private 6pn (Rails EC2 can't reach it via HTTP but
# both sides speak to the same Valkey).
#
# If the agent Machine is stopped (scale-to-zero), the pub/sub message
# is lost — but the engine re-reads agent config fresh from Postgres on
# every job, so the new state is picked up on the next message anyway.
module EngineSync
  module_function

  def trigger(agent)
    return unless agent&.id
    redis.publish("agent-#{agent.id}-sync", { type: "config_reload", timestamp: Time.now.to_i }.to_json)
    Rails.logger.info "EngineSync: published config_reload for agent #{agent.id}"
  rescue => e
    Rails.logger.warn "EngineSync failed for agent #{agent&.id}: #{e.message}"
  end

  def self.redis
    @redis ||= Redis.new(url: ENV.fetch("REDIS_URL"))
  end
end
