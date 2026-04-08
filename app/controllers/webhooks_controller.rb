class WebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_user!, only: []

  # POST /webhooks/email
  def email
    agent = find_agent_by_channel("email", "address", params[:to])
    return head :not_found unless agent

    enqueue(agent, "email", {
      from: params[:from],
      from_name: params[:from_name],
      subject: params[:subject],
      body: params[:text] || params[:body] || params[:html],
    })
    head :ok
  end

  # POST /webhooks/slack
  def slack
    # Slack URL verification challenge
    if params[:type] == "url_verification"
      return render json: { challenge: params[:challenge] }
    end

    event = params[:event]
    return head :ok unless event&.dig(:type) == "message" && !event[:bot_id]

    agent = find_agent_by_channel("slack", "workspace_id", params[:team_id])
    return head :not_found unless agent

    enqueue(agent, "slack", {
      from: event[:user],
      body: event[:text],
      metadata: { channel: event[:channel], thread_ts: event[:thread_ts], ts: event[:ts] },
    })
    head :ok
  end

  # POST /webhooks/whatsapp
  def whatsapp
    from = params[:From]&.gsub("whatsapp:", "")
    agent = find_agent_by_channel("whatsapp", "phone_number", params[:To]&.gsub("whatsapp:", ""))
    return head :not_found unless agent

    enqueue(agent, "whatsapp", {
      from: from,
      body: params[:Body],
      metadata: { message_sid: params[:MessageSid], num_media: params[:NumMedia] },
    })
    head :ok
  end

  # POST /webhooks/sms
  def sms
    agent = find_agent_by_channel("sms", "phone_number", params[:To])
    return head :not_found unless agent

    enqueue(agent, "sms", {
      from: params[:From],
      body: params[:Body],
      metadata: { message_sid: params[:MessageSid] },
    })
    head :ok
  end

  # POST /webhooks/telegram/:bot_token
  def telegram
    message = params.dig(:message)
    return head :ok unless message

    agent = find_agent_by_channel_config("telegram") do |config|
      config.dig("bot_token") == params[:bot_token]
    end
    return head :not_found unless agent

    enqueue(agent, "telegram", {
      from: "#{message.dig(:from, :first_name)} #{message.dig(:from, :last_name)}".strip,
      from_name: message.dig(:from, :username),
      body: message[:text],
      metadata: { chat_id: message.dig(:chat, :id), message_id: message[:message_id] },
    })
    head :ok
  end

  # POST /webhooks/web
  def web
    authenticate_user!
    agent = Agent.find(params[:agent_id])
    return head :not_found unless agent

    # Create/find internal conversation with user_id
    conversation = agent.conversations.find_or_create_by!(
      organization: agent.organization,
      kind: "internal",
      user: current_user,
      contact_identifier: current_user.email
    ) do |c|
      c.contact_name = current_user.name
      c.contact_email = current_user.email
      c.status = "active"
    end

    # Save user's message immediately (so it shows in chat)
    conversation.messages.create!(
      role: "user",
      content: params[:body],
      direction: "inbound",
      channel: "web"
    )

    # Push to engine with conversation ID
    enqueue(agent, "web", {
      from: current_user.email,
      from_name: current_user.name,
      body: params[:body],
      conversationId: conversation.id,
    })
    head :ok
  end

  private

  def find_agent_by_channel(channel_type, config_key, value)
    return nil unless value.present?

    channel_config = ChannelConfig
      .where(channel_type: channel_type, enabled: true)
      .where("config->>? = ?", config_key, value)
      .first

    channel_config&.agent
  end

  def find_agent_by_channel_config(channel_type, &block)
    ChannelConfig
      .where(channel_type: channel_type, enabled: true)
      .find { |cc| block.call(cc.config) }
      &.agent
  end

  def enqueue(agent, channel, payload)
    conversation_id = payload.delete(:conversationId)
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    redis.lpush("agent-inbox-#{agent.id}", {
      type: "inbound_message",
      agentId: agent.id.to_s,
      orgId: agent.organization_id,
      channel: channel,
      conversationId: conversation_id,
      payload: payload,
    }.to_json)
  end
end
