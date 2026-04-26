require "mini_mime"
require "net/http"

class WebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant

  # POST /webhooks/email
  def email
    case sns_message_type
    when "SubscriptionConfirmation"
      confirm_sns_subscription
    when "Notification"
      notification = parse_sns_message
      Email::InboundProcessor.new(notification).call if notification
      head :ok
    else
      # Fallback: simple form-encoded format (for testing without SNS)
      process_simple_inbound
    end
  end

  # POST /webhooks/email_bounces
  def email_bounces
    case sns_message_type
    when "SubscriptionConfirmation"
      confirm_sns_subscription
    when "Notification"
      notification = parse_sns_message
      Email::BounceHandler.new(notification).call if notification
      head :ok
    else
      head :ok
    end
  end

  # POST /webhooks/email_complaints
  def email_complaints
    case sns_message_type
    when "SubscriptionConfirmation"
      confirm_sns_subscription
    when "Notification"
      notification = parse_sns_message
      Email::ComplaintHandler.new(notification).call if notification
      head :ok
    else
      head :ok
    end
  end

  # POST /webhooks/slack
  def slack
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
    return head :forbidden unless valid_twilio_request?

    from = params[:From]&.gsub("whatsapp:", "")
    agent = find_agent_by_channel("whatsapp", "phone_number", params[:To]&.gsub("whatsapp:", ""))
    return head :not_found unless agent

    # Sprint 1b — fetch any media from Twilio (basic auth) and store as ActiveStorage blobs
    attachment_signed_ids = fetch_twilio_media(params)

    enqueue(agent, "whatsapp", {
      from: from,
      body: params[:Body],
      attachment_ids: attachment_signed_ids,
      metadata: { message_sid: params[:MessageSid], num_media: params[:NumMedia] },
    })
    head :ok
  end

  # POST /webhooks/sms
  def sms
    return head :forbidden unless valid_twilio_request?

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

    # The agent's runtime must be live before we accept user messages — the
    # engine can't process them while the machine is still provisioning.
    unless agent.status == "running"
      return render json: { error: "Agent is not running", status: agent.status }, status: :conflict
    end

    # Use the most recently active internal conv for this user — avoids
    # fragmenting chat history across multiple conversations when old rows
    # exist with different contact_identifier values.
    conversation = agent.conversations
      .where(kind: "internal", user: current_user)
      .order(updated_at: :desc)
      .first
    conversation ||= agent.conversations.create!(
      organization: agent.organization,
      kind: "internal",
      user: current_user,
      contact_identifier: current_user.email,
      contact_name: current_user.name,
      contact_email: current_user.email,
      status: "active",
    )

    # Sprint 1c (direct upload) — files were already uploaded by the browser
    # via @rails/activestorage DirectUpload. We just receive the signed_ids
    # and attach the resulting blobs to the new Message.
    attachment_signed_ids = Array(params[:attachment_signed_ids]).select(&:present?)

    message = conversation.messages.create!(
      role: "user",
      content: params[:body].to_s,
      direction: "inbound",
      channel: "web",
      metadata: attachment_signed_ids.any? ? { attachment_ids: attachment_signed_ids } : {},
    )

    # Attach via ActiveStorage so the conversation UI can render them naturally
    if attachment_signed_ids.any?
      attachment_signed_ids.each do |sid|
        message.attachments.attach(sid)
      rescue => e
        Rails.logger.warn "webhooks/web: failed to attach signed_id #{sid}: #{e.message}"
      end
    end

    enqueue(agent, "web", {
      from: current_user.email,
      from_name: current_user.name,
      body: params[:body].to_s,
      attachment_ids: attachment_signed_ids,
      conversationId: conversation.id,
    })
    head :ok
  end

  private

  # ── SNS helpers ────────────────────────────────────────────────

  def sns_message_type
    request.headers["x-amz-sns-message-type"]
  end

  def parse_sns_message
    raw = request.body.read
    sns_body = Email::SnsVerifier.verify(raw)
    return nil unless sns_body

    JSON.parse(sns_body["Message"])
  rescue JSON::ParserError => e
    Rails.logger.error "Invalid SNS Message field: #{e.message}"
    nil
  end

  def confirm_sns_subscription
    raw = request.body.read
    body = Email::SnsVerifier.verify(raw)
    return head :forbidden unless body

    # Only confirm subscriptions to our known SNS topics
    topic_arn = body["TopicArn"].to_s
    unless topic_arn.start_with?("arn:aws:sns:") && topic_arn.include?("alchemy-")
      Rails.logger.warn "Refusing SNS subscription to unknown topic: #{topic_arn}"
      return head :forbidden
    end

    Net::HTTP.get(URI(body["SubscribeURL"]))
    head :ok
  end

  # ── Simple inbound (testing fallback) ──────────────────────────

  def process_simple_inbound
    agent = find_agent_by_channel("email", "address", params[:to])
    return head :not_found unless agent

    conversation = Email::Threading.find_or_create(
      agent: agent,
      contact_email: params[:from],
      contact_name: params[:from_name],
      subject: params[:subject],
    )

    conversation.messages.create!(
      role: "user",
      content: params[:text] || params[:body] || params[:html] || "",
      direction: "inbound",
      channel: "email",
      metadata: { from: params[:from], from_name: params[:from_name], subject: params[:subject] },
    )

    Email::Queue.enqueue_inbound(agent, conversation, {
      from: params[:from],
      from_name: params[:from_name],
      subject: params[:subject],
      body: params[:text] || params[:body] || params[:html],
    })
    head :ok
  end

  # ── Channel agent lookup ───────────────────────────────────────

  def find_agent_by_channel(channel_type, config_key, value)
    return nil unless value.present?

    ChannelConfig
      .where(channel_type: channel_type, enabled: true)
      .where("config->>? = ?", config_key, value)
      .first&.agent
  end

  def find_agent_by_channel_config(channel_type, &block)
    ChannelConfig
      .where(channel_type: channel_type, enabled: true)
      .find { |cc| block.call(cc.config) }
      &.agent
  end

  def valid_twilio_request?
    # Skip validation in development — ngrok terminates SSL which breaks
    # Twilio's signature (they sign against HTTPS, Rails sees HTTP).
    # Production should always validate.
    return true if Rails.env.development?
    return true unless ENV["TWILIO_AUTH_TOKEN"].present?

    validator = Twilio::Security::RequestValidator.new(ENV["TWILIO_AUTH_TOKEN"])
    validator.validate(request.original_url, request.POST, request.headers["X-Twilio-Signature"] || "")
  end

  # Sprint 1b — pull each MediaUrl{i} from Twilio webhook params, fetch with
  # basic auth, store as ActiveStorage::Blob, return signed_ids for the engine.
  def fetch_twilio_media(params)
    num = params[:NumMedia].to_i
    return [] if num.zero?

    sid = ENV["TWILIO_ACCOUNT_SID"]
    token = ENV["TWILIO_AUTH_TOKEN"]
    return [] unless sid.present? && token.present?

    signed_ids = []
    num.times do |i|
      url = params["MediaUrl#{i}"]
      content_type = params["MediaContentType#{i}"] || "application/octet-stream"
      next if url.blank?

      begin
        # Twilio MediaUrls return the file directly when authed, or 302 to
        # a temporary S3 URL. Use open-uri with redirect following for simplicity.
        uri = URI(url)
        bytes = download_with_auth_and_redirects(uri, sid, token)

        if bytes.nil? || bytes.length < 500
          Rails.logger.warn "fetch_twilio_media: MediaUrl#{i} returned only #{bytes&.length || 0} bytes, skipping"
          next
        end

        ext = MiniMime.lookup_by_content_type(content_type)&.extension || "bin"
        blob = ActiveStorage::Blob.create_and_upload!(
          io: StringIO.new(bytes),
          filename: "whatsapp-#{params[:MessageSid]}-#{i}.#{ext}",
          content_type: content_type,
        )
        signed_ids << blob.signed_id
        Rails.logger.info "fetch_twilio_media: stored MediaUrl#{i} as #{blob.filename} (#{bytes.length} bytes)"
      rescue => e
        Rails.logger.error "fetch_twilio_media: failed to fetch MediaUrl#{i}: #{e.message}"
      end
    end
    signed_ids
  end

  # Download a URL with basic auth, following up to 3 redirects. Redirects
  # (like Twilio's 302 to S3) don't need auth — only the initial request does.
  def download_with_auth_and_redirects(uri, username, password, max_redirects = 3)
    max_redirects.times do
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == "https")
      http.open_timeout = 10
      http.read_timeout = 30

      req = Net::HTTP::Get.new(uri)
      req.basic_auth(username, password) if username

      response = http.request(req)

      case response
      when Net::HTTPSuccess
        return response.body
      when Net::HTTPRedirection
        uri = URI(response["location"])
        username = nil # Don't send auth to the redirect target (S3)
        password = nil
      else
        Rails.logger.error "download_with_auth_and_redirects: #{uri} returned #{response.code}"
        return nil
      end
    end
    Rails.logger.error "download_with_auth_and_redirects: too many redirects for #{uri}"
    nil
  end

  # ── Generic enqueue (non-email channels) ───────────────────────

  def enqueue(agent, channel, payload)
    conversation_id = payload.delete(:conversationId)
    # Idempotency — Twilio / Telegram retry webhooks on timeout / 5xx. Derive
    # a stable job_id from the provider's native message id when present so a
    # double-webhook doesn't enqueue the same inbound twice. Falls back to a
    # random UUID (current behavior) if no provider id is available.
    meta = payload[:metadata] || {}
    provider_id = meta[:message_sid] || meta[:message_id]
    job_id = provider_id.present? ? "inbound-#{channel}-#{provider_id}" : nil
    AgentEventBus.publish(
      type: "inbound_message",
      agent: agent,
      channel: channel,
      conversation_id: conversation_id,
      job_id: job_id,
      payload: payload,
    )
  end
end
