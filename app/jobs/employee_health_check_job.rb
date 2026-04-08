class EmployeeHealthCheckJob < ApplicationJob
  queue_as :default

  def perform
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))

    Agent.where(status: ["running", "starting"]).find_each do |agent|
      raw = redis.get("health:#{agent.id}")

      if raw
        health = JSON.parse(raw)
        age_seconds = (Time.now.to_f * 1000 - health["timestamp"].to_f) / 1000

        if age_seconds < 180 # healthy if reported within 3 minutes
          agent.update_column(:status, "running") if agent.status != "running"
        else
          agent.update_column(:status, "stopped") # stale health = stopped
        end
      else
        # No health data — agent may have never started or crashed
        agent.update_column(:status, "stopped") if agent.status == "running"
      end
    end
  end
end
