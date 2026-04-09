class OutboundEmailPollerJob < ApplicationJob
  queue_as :default

  def perform
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    10.times do
      raw = redis.rpop("outbound-email")
      break unless raw
      payload = JSON.parse(raw)
      SendEmailJob.perform_later(payload)
    end
  end
end
