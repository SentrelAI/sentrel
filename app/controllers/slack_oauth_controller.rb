require "net/http"
require "uri"
require "json"

# Slack-as-channel OAuth install flow.
#
# Multi-agent model:
#   - ONE Slack app per workspace (one bot user, one install).
#   - First agent in the org to install triggers the OAuth dance + persists
#     the bot_token on its ChannelConfig.secret_config.
#   - Subsequent agents in the SAME org skip OAuth: we reuse the existing
#     bot_token, provision a dedicated channel for each agent, and bind it.
#   - Outbound messages use chat.postMessage with per-agent username +
#     icon_url overrides so each agent reads as its own identity in Slack.
#
# Inbound routing: by (team_id, channel_id) — the channel uniquely identifies
# the agent within a workspace.
#
# Env required:
#   SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET
class SlackOauthController < ApplicationController
  before_action :authenticate_user!, except: [:callback]

  REDIRECT_URI_PATH = "/slack/oauth/callback".freeze
  SCOPES = %w[
    app_mentions:read
    chat:write
    chat:write.customize
    channels:manage
    channels:read
    channels:history
    groups:write
    groups:history
    im:history
    im:read
    im:write
    users:read
    users:read.email
  ].freeze

  # GET /slack/install?agent_id=AGT
  # If the org already has a connected Slack install, skip the OAuth round-trip
  # and just provision a channel for this agent.
  def install
    return redirect_with_alert("SLACK_CLIENT_ID not configured") if ENV["SLACK_CLIENT_ID"].blank?
    agent = resolve_agent(params[:agent_id])
    return redirect_with_alert("Agent not found") unless agent

    existing = org_slack_install(current_tenant)
    if existing
      provision_channel_for(agent, existing)
      return redirect_to agent_channel_configs_path(agent),
        notice: "Added Slack channel ##{agent.channel_configs.find_by(channel_type: 'slack')&.config&.dig('slack_channel_name')} for #{agent.name}"
    end

    # No existing install — kick off OAuth for the first agent in the org.
    nonce = SecureRandom.hex(16)
    session[:slack_install_nonce]    = nonce
    session[:slack_install_agent_id] = agent.id

    state = Base64.urlsafe_encode64({ agent_id: agent.id, nonce: nonce }.to_json)
    url = "https://slack.com/oauth/v2/authorize?" + URI.encode_www_form(
      client_id: ENV["SLACK_CLIENT_ID"],
      scope: SCOPES.join(","),
      redirect_uri: callback_url,
      state: state,
    )
    redirect_to url, allow_other_host: true
  end

  # GET /slack/oauth/callback?code=...&state=...
  def callback
    state = JSON.parse(Base64.urlsafe_decode64(params[:state].to_s)) rescue {}
    nonce = state["nonce"]
    agent_id = state["agent_id"]
    return redirect_with_alert("Invalid OAuth state") if nonce.blank? || agent_id.blank?
    return redirect_with_alert("OAuth state mismatch")  if nonce != session.delete(:slack_install_nonce)
    return redirect_with_alert("Agent mismatch")        if agent_id.to_i != session.delete(:slack_install_agent_id).to_i

    agent = Agent.find_by(id: agent_id)
    return redirect_with_alert("Agent not found") unless agent

    res = exchange_code(params[:code])
    return redirect_with_alert("Slack OAuth failed: #{res['error'] || 'unknown'}") unless res["ok"]

    bot_token   = res["access_token"]
    bot_user_id = res["bot_user_id"]
    team_id     = res.dig("team", "id")
    team_name   = res.dig("team", "name")
    app_id      = res["app_id"]

    # Persist the install on this agent's ChannelConfig. Other agents in the
    # org will reuse these secrets via org_slack_install / provision_channel_for.
    cc = agent.channel_configs.find_or_initialize_by(channel_type: "slack")
    cc.config = (cc.config || {}).merge(
      "team_id" => team_id,
      "team_name" => team_name,
      "bot_user_id" => bot_user_id,
      "app_id" => app_id,
    )
    cc.secrets = { "bot_token" => bot_token, "signing_secret" => ENV["SLACK_SIGNING_SECRET"] }
    cc.status  = "connected"
    cc.enabled = true
    cc.save!

    # Auto-create a channel for this agent.
    provision_channel_for(agent, cc)

    EngineSync.trigger(agent)
    redirect_to agent_channel_configs_path(agent), notice: "Connected #{team_name} to #{agent.name}"
  end

  # DELETE /slack/oauth/disconnect?agent_id=AGT
  # Removes this agent's binding. We don't uninstall the workspace app — other
  # agents in the org may still be using it. Uninstalling requires the
  # workspace admin to remove "Alchemy Agents" from the Slack workspace.
  def disconnect
    agent = resolve_agent(params[:agent_id])
    return redirect_with_alert("Agent not found") unless agent
    cc = agent.channel_configs.find_by(channel_type: "slack")
    if cc
      cc.destroy
      EngineSync.trigger(agent)
    end
    redirect_to agent_channel_configs_path(agent), notice: "Slack disconnected"
  end

  private

  # Returns the first connected Slack ChannelConfig in the org — used as the
  # install reference so subsequent agents can reuse bot_token without
  # re-OAuthing. Returns nil if no agent in the org has installed Slack yet.
  def org_slack_install(org)
    org.agents.joins(:channel_configs)
      .where(channel_configs: { channel_type: "slack", enabled: true, status: "connected" })
      .merge(ChannelConfig.where(channel_type: "slack"))
      .map { |a| a.channel_configs.find_by(channel_type: "slack") }
      .compact
      .find { |c| c.secrets["bot_token"].present? }
  end

  # Provision a Slack channel for this agent. Reuses the source install's
  # bot_token + signing_secret + team_id/bot_user_id. Idempotent: if the
  # agent already has a slack ChannelConfig with a channel_id, skip the
  # create and just refresh the secrets.
  def provision_channel_for(agent, source_install_cc)
    bot_token = source_install_cc.secrets["bot_token"]
    return unless bot_token.present?

    cc = agent.channel_configs.find_or_initialize_by(channel_type: "slack")
    cc.config = (cc.config || {}).merge(
      "team_id" => source_install_cc.config["team_id"],
      "team_name" => source_install_cc.config["team_name"],
      "bot_user_id" => source_install_cc.config["bot_user_id"],
      "app_id" => source_install_cc.config["app_id"],
    )
    cc.secrets = source_install_cc.secrets  # share token + signing_secret
    cc.status  = "connected"
    cc.enabled = true

    if cc.config["slack_channel_id"].blank?
      channel_name = Slack::Api.sanitize_channel_name(agent.slug.presence || agent.name)
      created = Slack::Api.create_channel(token: bot_token, name: channel_name)
      if created["ok"]
        cc.config = cc.config.merge(
          "slack_channel_id"   => created.dig("channel", "id"),
          "slack_channel_name" => created.dig("channel", "name"),
        )
        # Invite the bot user (some workspaces require explicit invite).
        Slack::Api.invite_to_channel(
          token: bot_token,
          channel: created.dig("channel", "id"),
          user: source_install_cc.config["bot_user_id"],
        )
        Slack::Api.set_channel_topic(
          token: bot_token,
          channel: created.dig("channel", "id"),
          topic: "#{agent.name} — #{agent.role}. DM or @mention to talk.",
        )
      elsif created["error"] == "name_taken"
        # Channel name collision — append a short suffix and retry once.
        fallback_name = Slack::Api.sanitize_channel_name("#{channel_name}-#{SecureRandom.hex(2)}")
        retry_result = Slack::Api.create_channel(token: bot_token, name: fallback_name)
        if retry_result["ok"]
          cc.config = cc.config.merge(
            "slack_channel_id"   => retry_result.dig("channel", "id"),
            "slack_channel_name" => retry_result.dig("channel", "name"),
          )
        else
          Rails.logger.warn "[SlackOauth] channel create failed for #{agent.id}: #{retry_result['error']}"
        end
      else
        Rails.logger.warn "[SlackOauth] channel create failed for #{agent.id}: #{created['error']}"
      end
    end

    cc.save!
    EngineSync.trigger(agent)
  end

  def resolve_agent(id)
    return nil if id.blank?
    # The frontend ships the prefixed string id (agt_xxx) — find_by_public_id!
    # decodes it through the PrefixedIds gem and scopes to current_tenant.
    find_by_public_id!(current_tenant.agents, id)
  rescue ActiveRecord::RecordNotFound, StandardError
    nil
  end

  def callback_url
    "#{request.protocol}#{request.host_with_port}#{REDIRECT_URI_PATH}"
  end

  def exchange_code(code)
    uri = URI.parse("https://slack.com/api/oauth.v2.access")
    req = Net::HTTP::Post.new(uri)
    req.set_form_data(
      client_id: ENV["SLACK_CLIENT_ID"],
      client_secret: ENV["SLACK_CLIENT_SECRET"],
      code: code,
      redirect_uri: callback_url,
    )
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(req) }
    JSON.parse(res.body)
  rescue StandardError => e
    Rails.logger.error "[SlackOauth] exchange failed: #{e.class}: #{e.message}"
    { "ok" => false, "error" => e.message }
  end

  def redirect_with_alert(msg)
    redirect_to (current_user ? dashboard_path : root_path), alert: msg
  end
end
