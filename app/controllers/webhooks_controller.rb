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

    chat_id = message.dig(:chat, :id)
    display = "#{message.dig(:from, :first_name)} #{message.dig(:from, :last_name)}".strip
    user_id = resolve_user_for_channel("telegram", chat_id, display: display, organization: agent.organization)

    # Splice into the user's recent active conversation across any channel.
    # Item 10b — Telegram inbound on a thread the user already has on web
    # continues the same conversation; new conversations only created when
    # there's no recent thread within the 7-day window.
    conversation = build_or_extend_conversation(
      agent: agent,
      user_id: user_id,
      channel: "telegram",
      contact_identifier: "tg:#{chat_id}",
      contact_name: display,
    )

    conversation.messages.create!(
      role: "user",
      content: message[:text].to_s,
      direction: "inbound",
      channel: "telegram",
      sender_name: display,
      sender_email: nil,
      sender_user_id: user_id,
      metadata: { chat_id: chat_id, message_id: message[:message_id] },
    )

    enqueue(agent, "telegram", {
      from: display,
      from_name: message.dig(:from, :username),
      body: message[:text],
      conversationId: conversation.id,
      user_id: user_id,
      metadata: { chat_id: chat_id, message_id: message[:message_id] },
    })
    head :ok
  end

  # POST /webhooks/web
  def web
    authenticate_user!
    agent = Agent.find(params[:agent_id])
    return head :not_found unless agent

    # If the engine is asleep (Fly auto-stop scaled to zero), persist the
    # message anyway and poke Fly to wake the machine. Engine boots ~30s,
    # subscribes to Redis, drains its inbox queue, processes this message.
    # Frontend reads `cold_start: true` to render the "Waking …" banner.
    cold_start = false
    if agent.status != "running"
      cold_start = true
      AgentMachineOps.start(agent) rescue nil
    end

    # Item 10 — splice into the most-recent active conversation FOR THIS USER
    # across any channel (web, telegram, …). Bypassing the channel restriction
    # is the whole point: starting on Telegram and continuing on web should
    # land in the same thread, not fragment.
    conversation = build_or_extend_conversation(
      agent: agent,
      user_id: current_user.id,
      channel: "web",
      contact_identifier: current_user.email,
      contact_name: current_user.name,
      contact_email: current_user.email,
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
      sender_name: current_user.name,
      sender_email: current_user.email,
      sender_user_id: current_user.id,
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

    # Resolve attachments to {url, filename, content_type, byte_size} so the
    # engine can fetch directly from S3 (or local Disk in dev) without round-
    # tripping through Rails. URL is presigned and expires in 1 hour — long
    # enough for any normal agent run, short enough that it can't be hoarded.
    attachments_payload = message.attachments.map do |att|
      blob = att.blob
      {
        signed_id: att.signed_id,
        url: blob.url(expires_in: 1.hour, disposition: "attachment"),
        filename: blob.filename.to_s,
        content_type: blob.content_type,
        byte_size: blob.byte_size,
      }
    end

    enqueue(agent, "web", {
      from: current_user.email,
      from_name: current_user.name,
      body: params[:body].to_s,
      attachment_ids: attachment_signed_ids,
      attachments: attachments_payload,
      conversationId: conversation.id,
      user_id: current_user.id,
    })
    if cold_start
      render json: { status: "starting", agent_status: agent.status }, status: :accepted
    else
      head :ok
    end
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
      sender_name: params[:from_name].presence || params[:from],
      sender_email: params[:from],
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

  # ── Item 10 — cross-channel identity + conversation merge ──────

  # Resolve which user owns this channel+external_id pair. Returns the user id
  # or nil if the channel-side address is unknown and we don't have permission
  # to claim it. Telegram-first-contact policy: if the agent's organization
  # has exactly one owner, auto-claim the chat for that owner so they can
  # start chatting without a manual link step. Otherwise return nil and the
  # caller treats it as an unknown contact (existing fragmented-thread behaviour).
  def resolve_user_for_channel(channel, external_id, display: nil, organization: nil)
    return nil if external_id.blank? || organization.nil?
    user = UserIdentity.lookup(organization.id, channel, external_id)
    return user.id if user

    if channel == "telegram"
      auto_claim_user = organization.users.where(role: %w[owner admin]).order(:id).first
      if auto_claim_user
        UserIdentity.claim!(user: auto_claim_user, channel: channel, external_id: external_id, display_name: display) rescue nil
        Rails.logger.info "UserIdentity: auto-claimed #{channel}:#{external_id} for user #{auto_claim_user.id} (#{auto_claim_user.email}) in org #{organization.id}"
        return auto_claim_user.id
      end
    end

    nil
  end

  # Find an existing recent conversation for this user+agent across ANY
  # channel and either return it (so the new message extends the same
  # thread) or create a new conversation pointing at the existing root via
  # unified_conversation_id.
  def build_or_extend_conversation(agent:, user_id:, channel:, contact_identifier:, contact_name: nil, contact_email: nil)
    if user_id
      existing = Conversation.find_recent_for_user(
        user_id: user_id, agent_id: agent.id, organization_id: agent.organization_id,
      )
    end

    # Same channel + same user → just extend the same conversation row.
    if existing && existing.contact_identifier == contact_identifier
      return existing
    end

    # Different channel for the same user → create a new conversation row but
    # point it at the existing root so the engine sees a unified history.
    new_conv = agent.conversations.create!(
      organization: agent.organization,
      kind: "internal",
      user_id: user_id,
      contact_identifier: contact_identifier,
      contact_name: contact_name,
      contact_email: contact_email,
      status: "active",
      unified_conversation_id: existing&.unified_conversation_id || existing&.id,
    )
    if existing
      Rails.logger.info(
        "Conversation #{new_conv.id} (channel=#{channel}) spliced into unified group rooted at " \
        "#{new_conv.unified_conversation_id}"
      )
    end
    new_conv
  end

  # ── Generic enqueue (non-email channels) ───────────────────────

  def enqueue(agent, channel, payload)
    conversation_id = payload.delete(:conversationId)
    user_id = payload.delete(:user_id)
    # Idempotency — Twilio / Telegram retry webhooks on timeout / 5xx. Derive
    # a stable job_id from the provider's native message id when present so a
    # double-webhook doesn't enqueue the same inbound twice. Falls back to a
    # random UUID (current behavior) if no provider id is available.
    meta = payload[:metadata] || {}
    provider_id = meta[:message_sid] || meta[:message_id]
    job_id = provider_id.present? ? "inbound-#{channel}-#{provider_id}" : nil
    # Build a channel-specific origin so the engine can deliver report-backs
    # to the user without a live in-memory listener. For Telegram/WhatsApp/SMS
    # we need the channel-side address (chat_id, bot_token, twilio number,
    # etc.) inside metadata; for web a conversation_id is enough.
    origin = {
      channel: channel,
      conversationId: conversation_id,
      metadata: case channel
                when "telegram"
                  { bot_token: params[:bot_token], chat_id: meta[:chat_id] }.compact
                when "whatsapp", "sms"
                  { from: meta[:from], to: meta[:to] }.compact
                else
                  {}
                end,
    }
    AgentEventBus.publish(
      type: "inbound_message",
      agent: agent,
      channel: channel,
      conversation_id: conversation_id,
      user_id: user_id,
      origin: origin,
      job_id: job_id,
      payload: payload,
    )
  end
end
