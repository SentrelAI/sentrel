class EmployeeHealthCheckJob < ApplicationJob
  queue_as :default

  HEALTHY_WINDOW_SECONDS = 180

  def perform
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))

    # Check ALL agents (not just running ones) — engine may have come back online
    Agent.find_each do |agent|
      raw = redis.get("health:#{agent.id}")

      # Scale-to-zero: a sleeping agent's engine exited on purpose — no
      # heartbeat is the expected state, not an outage. A fresh heartbeat
      # (engine woke and reported in) still flips it back to running below.
      if agent.status == "sleeping"
        next unless raw
        health = JSON.parse(raw) rescue nil
        next unless health
        beat_at = Time.zone.at(health["timestamp"].to_f / 1000)
        fresh = (Time.now.to_f * 1000 - health["timestamp"].to_f) / 1000 < HEALTHY_WINDOW_SECONDS
        # The heartbeat written seconds BEFORE the engine slept stays fresh
        # for ~3 minutes — treating it as "the engine woke up" un-slept the
        # whole fleet and then tombstoned it as unresponsive. Only a beat
        # newer than the sleep transition proves a wake.
        woke_after_sleep = agent.instance&.stopped_at.nil? || beat_at > agent.instance.stopped_at
        mark_healthy(agent, beat_at) if fresh && woke_after_sleep
        next
      end

      if raw
        health = JSON.parse(raw)
        age_seconds = (Time.now.to_f * 1000 - health["timestamp"].to_f) / 1000
        last_seen_at = Time.zone.at(health["timestamp"].to_f / 1000)

        if age_seconds < HEALTHY_WINDOW_SECONDS
          mark_healthy(agent, last_seen_at)
        else
          mark_unresponsive(agent, "Engine heartbeat stale: last seen #{age_seconds.to_i}s ago")
        end
      else
        mark_unresponsive(agent, "No engine heartbeat found in Redis")
      end
    rescue JSON::ParserError => e
      mark_unresponsive(agent, "Engine heartbeat payload invalid: #{e.message}")
    end
  end

  private

  def mark_healthy(agent, last_seen_at)
    agent.update_column(:status, "running") unless agent.status == "running"
    return unless agent.instance

    attrs = {
      status: "running",
      health_checked_at: last_seen_at,
      updated_at: Time.current
    }
    if agent.instance.provisioning_error.to_s.start_with?("Engine heartbeat", "No engine heartbeat")
      attrs[:provisioning_error] = nil
    end
    agent.instance.update_columns(attrs)
  end

  def mark_unresponsive(agent, message)
    agent.update_column(:status, "stopped") unless agent.status == "stopped"
    return unless agent.instance

    # Don't clobber a real provisioning error (e.g. "Fly API HTTP 422:
    # machine limit exceeded", "image manifest not found"). A heartbeat
    # failure is downstream of provisioning success — if provisioning
    # never completed, the original error is the one operators need.
    # We overwrite only when the existing message is blank OR already a
    # heartbeat-related message we wrote ourselves.
    attrs = {
      status: "stopped",
      updated_at: Time.current
    }
    existing = agent.instance.provisioning_error.to_s
    if existing.blank? || existing.start_with?("Engine heartbeat", "No engine heartbeat", "Engine heartbeat payload invalid")
      attrs[:provisioning_error] = "#{message} at #{Time.current.utc.iso8601}"
    end
    agent.instance.update_columns(attrs)
  end
end
