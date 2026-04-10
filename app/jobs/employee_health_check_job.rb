class EmployeeHealthCheckJob < ApplicationJob
  queue_as :default

  def perform
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))

    # Check ALL agents (not just running ones) — engine may have come back online
    Agent.find_each do |agent|
      raw = redis.get("health:#{agent.id}")

      if raw
        health = JSON.parse(raw)
        age_seconds = (Time.now.to_f * 1000 - health["timestamp"].to_f) / 1000

        if age_seconds < 180 # healthy if reported within 3 minutes
          agent.update_column(:status, "running") unless agent.status == "running"
        else
          agent.update_column(:status, "stopped") unless agent.status == "stopped"
        end
      else
        # No health data — agent not running
        agent.update_column(:status, "stopped") unless agent.status == "stopped"
      end
    end
  end
end
