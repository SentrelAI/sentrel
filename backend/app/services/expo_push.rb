require "net/http"
require "json"
require "uri"

# Thin client for Expo's push service. We don't run our own APNS/FCM creds —
# Expo's hosted gateway (https://exp.host) accepts a batch of messages keyed
# by ExponentPushToken[…] and fans out to Apple/Google for us.
#
# Docs: https://docs.expo.dev/push-notifications/sending-notifications/
module ExpoPush
  ENDPOINT = "https://exp.host/--/api/v2/push/send".freeze

  module_function

  # messages: Array of {to:, title:, body:, data:, sound:, badge:}
  # Returns the parsed receipt body, or nil on transport failure. Never raises
  # — push is best-effort; a failed notification must not break the request or
  # job that triggered it.
  def send_messages(messages)
    messages = Array(messages).select { |m| valid_token?(m[:to] || m["to"]) }
    return nil if messages.empty?

    uri = URI(ENDPOINT)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 5
    http.read_timeout = 10

    req = Net::HTTP::Post.new(uri)
    req["Content-Type"] = "application/json"
    req["Accept"] = "application/json"
    req.body = JSON.generate(normalize(messages))

    res = http.request(req)
    unless res.is_a?(Net::HTTPSuccess)
      Rails.logger.warn("[ExpoPush] non-success #{res.code}: #{res.body.to_s.truncate(500)}")
      return nil
    end
    JSON.parse(res.body)
  rescue => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class}: #{e.message}")
    nil
  end

  def normalize(messages)
    messages.map do |m|
      {
        to: m[:to] || m["to"],
        title: m[:title] || m["title"],
        body: m[:body] || m["body"],
        data: m[:data] || m["data"] || {},
        sound: m[:sound] || m["sound"] || "default",
        badge: m[:badge] || m["badge"],
        priority: "high"
      }.compact
    end
  end

  def valid_token?(token)
    token.to_s.start_with?("ExponentPushToken[", "ExpoPushToken[")
  end
end
