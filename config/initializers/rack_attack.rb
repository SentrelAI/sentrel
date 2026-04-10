class Rack::Attack
  ### Throttle webhooks ###

  # Throttle inbound email/bounce/complaint webhooks per IP
  # SES/SNS hits these from a known set of AWS IPs but we still want to
  # protect against bursts and abuse.
  throttle("webhooks/email", limit: 60, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/webhooks/email")
  end

  # Throttle Twilio webhooks (whatsapp/sms) per IP
  throttle("webhooks/twilio", limit: 60, period: 1.minute) do |req|
    req.ip if req.path == "/webhooks/whatsapp" || req.path == "/webhooks/sms"
  end

  # Throttle Telegram webhook per IP
  throttle("webhooks/telegram", limit: 60, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/webhooks/telegram")
  end

  # Throttle web chat (authenticated, but still rate-limit per user)
  throttle("webhooks/web", limit: 30, period: 1.minute) do |req|
    req.ip if req.path == "/webhooks/web"
  end

  # Throttle login attempts
  throttle("logins/ip", limit: 10, period: 5.minutes) do |req|
    req.ip if req.path == "/users/sign_in" && req.post?
  end

  ### Block obvious abuse ###

  # Block requests with no User-Agent (likely bots)
  blocklist("missing user-agent on webhooks") do |req|
    req.path.start_with?("/webhooks/") && req.user_agent.blank?
  end

  ### Custom response ###

  self.throttled_responder = lambda do |request|
    [
      429,
      { "Content-Type" => "application/json" },
      [{ error: "Throttled. Try again later." }.to_json],
    ]
  end
end

# Use Redis as the cache store for rate limit counters (works across processes)
Rack::Attack.cache.store = ActiveSupport::Cache::RedisCacheStore.new(
  url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"),
  namespace: "rack-attack",
)
