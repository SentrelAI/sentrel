require "redis"

# Tells a running agent engine to reload its filesystem-projected state
# (soul.md, skills/, channel handlers). Per-job state — capabilities,
# identity prose, ai_config, command_allowlist — already syncs because
# the engine refreshes the agent row on every job in main.ts.
#
# Transport: Redis pub/sub on `agent-<id>-sync`. The engine subscribes at
# boot ("Sync sub: listening on agent-<id>-sync") and runs the same
# handler the HTTPS /sync path runs. We use pub/sub instead of HTTPS
# because per-agent Fly apps aren't always provisioned with a public
# IPv4/IPv6 — DNS lookups for alchemy-<env>-agent-<id>.fly.dev fail with
# 'No address associated with hostname' when no public IP is allocated.
# Redis is the existing shared transport (Rails already uses it for the
# BullMQ inbox), so it's reachable from both sides without DNS / TLS.
#
# Trade-off: this only delivers if the engine process is running. A
# stopped Machine won't auto-wake on a Redis publish (HTTPS would have).
# That's fine because Rails ALSO publishes inbox jobs on Redis which
# DOES wake Machines via the same BullMQ + Fly auto_start path; for
# config sync we just queue up and the change is picked up the moment
# the engine boots for its next message — same behaviour as the rescue
# path on the HTTPS version.
module EngineSync
  module_function

  def trigger(agent)
    return unless agent&.id

    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    channel = "agent-#{agent.id}-sync"
    receivers = redis.publish(channel, "{}")
    Rails.logger.info "EngineSync: published to #{channel} (#{receivers} subscribers)"
  rescue => e
    # Non-fatal. Engine re-reads agent config on every job anyway, so the
    # next inbound message picks up any change if this sync fails.
    Rails.logger.warn "EngineSync failed for agent #{agent&.id}: #{e.message}"
  end
end
