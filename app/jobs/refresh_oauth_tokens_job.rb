require "net/http"
require "uri"
require "json"

# Periodic refresh of subscription OAuth tokens (Anthropic Pro/Max/Team,
# ChatGPT Plus/Pro/Business). Runs every 30 minutes via cron — refreshes any
# credential expiring within the next hour, then pushes the new env to every
# Fly Machine running an agent that uses that provider.
#
# If the refresh fails (provider rotated client_id, network blip, user
# revoked), the job logs and skips. Engine will get a 401 on next request and
# the user has to re-connect via /oauth/:provider/connect.
class RefreshOauthTokensJob < ApplicationJob
  queue_as :default

  def perform
    refreshable = OauthCredential.where("expires_at IS NOT NULL AND expires_at < ?", 1.hour.from_now).where(kind: "ai_provider")
    return if refreshable.empty?

    refreshable.find_each do |cred|
      refresh_one(cred)
    end
  end

  private

  def refresh_one(cred)
    return unless cred.refresh_token.present?

    base = ENV.fetch("WEBHOOK_BASE_URL", "http://localhost:3000")
    tokens = case cred.provider
             when "anthropic"
               post_json("https://console.anthropic.com/v1/oauth/token", {
                 grant_type: "refresh_token",
                 refresh_token: cred.refresh_token,
                 client_id: "#{base}/oauth/anthropic/client-metadata",
               })
             when "openai"
               post_json("https://auth.openai.com/oauth/token", {
                 grant_type: "refresh_token",
                 refresh_token: cred.refresh_token,
                 client_id: "#{base}/oauth/openai/client-metadata",
               })
             end

    cred.access_token  = tokens["access_token"]
    cred.refresh_token = tokens["refresh_token"] if tokens["refresh_token"].present?
    if tokens["expires_in"].present?
      cred.expires_at = Time.current + tokens["expires_in"].to_i.seconds
    elsif tokens["expires_at"].present?
      cred.expires_at = Time.zone.at(tokens["expires_at"].to_i)
    end
    cred.last_refreshed_at = Time.current
    cred.save!

    Rails.logger.info("OAuth refresh ok: #{cred.provider} for org #{cred.organization_id}")
    push_env_to_fly(cred)
  rescue => e
    Rails.logger.error("OAuth refresh failed (#{cred.provider}, org #{cred.organization_id}): #{e.class}: #{e.message}")
  end

  def push_env_to_fly(cred)
    Agent.where(organization_id: cred.organization_id).find_each do |agent|
      next unless agent.ai_config&.provider == "#{cred.provider}_account"
      AgentMachineOps.reload(agent) rescue nil
    end
  end

  def post_json(url, body)
    uri = URI.parse(url)
    req = Net::HTTP::Post.new(uri)
    req["Content-Type"] = "application/json"
    req["Accept"] = "application/json"
    req.body = body.to_json
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30, open_timeout: 5) { |http| http.request(req) }
    raise "token endpoint #{res.code}: #{res.body.to_s[0..300]}" unless res.is_a?(Net::HTTPSuccess)
    JSON.parse(res.body)
  end
end
