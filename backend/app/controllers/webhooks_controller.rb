require "mini_mime"
require "net/http"

class WebhooksController < ApplicationController
  # Skip CSRF + tenant resolution — webhooks are unauthenticated entrypoints
  # gated by per-provider signature verification (HMAC for Slack, AWS SNS
  # confirmation for SES, Twilio signature, etc.).
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
  # Slack-as-channel inbound. Verifies HMAC signature, dedups by event_id,
  # routes by team_id to the matching ChannelConfig, enqueues an inbound
  # message. Outbound replies happen via Slack::OutboundSender, not here.
  def slack
    body = request.raw_post

    # URL verification challenge — Slack hits this once when you set the
    # request_url. No signature header on this request type.
    parsed = JSON.parse(body) rescue {}
    if parsed["type"] == "url_verification"
      return render json: { challenge: parsed["challenge"] }
    end

    return head :unauthorized unless valid_slack_signature?(body)

    # Slack retries on a 3s timeout — idempotency is on us. Stash event_id in
    # Redis for 5min so retries become a no-op.
    event_id = parsed["event_id"]
    if event_id.present? && slack_event_seen?(event_id)
      return head :ok
    end

    event = parsed["event"]
    return head :ok unless event

    # Skip bot echoes (our own outbound) + non-text events.
    return head :ok if event["bot_id"].present?
    return head :ok unless %w[message app_mention].include?(event["type"])
    # Skip Slack's system subtypes — message_changed (from our own chat.update
    # on Block Kit cards), message_deleted, channel_join, etc. We only want
    # genuine new messages from humans. Without this filter, every approval
    # card edit fires a 'message' event with empty text and the agent
    # replies 'Didn't catch a message there.'
    return head :ok if event["subtype"].present? && event["subtype"] != "file_share"
    # Empty text + no attachments = not a real message (covers edge cases
    # where Slack sends a stub event with no usable payload).
    return head :ok if event["text"].to_s.strip.empty? && event["files"].blank?

    team_id     = parsed["team_id"]
    channel_id  = event["channel"]
    is_dm       = event["channel_type"] == "im"

    agent = if is_dm
              # DMs: route by binding first, then org's front-desk agent, then
              # nothing (we'll post a picker reply via slack_dm_picker_reply).
              find_slack_dm_agent(team_id: team_id, im_channel_id: channel_id) ||
                find_org_default_slack_agent(team_id: team_id)
    else
              # Channel messages: exact (team_id, channel_id) match required.
              find_slack_agent(team_id: team_id, channel_id: channel_id)
    end

    if agent.nil? && is_dm
      respond_with_dm_picker(team_id: team_id, channel: channel_id)
      return head :ok
    end
    return head :ok unless agent

    enqueue(agent, "slack", {
      from: event["user"],
      body: event["text"],
      metadata: {
        channel: channel_id,
        thread_ts: event["thread_ts"] || event["ts"],
        ts: event["ts"],
        event_type: event["type"],
        team_id: team_id,
        is_dm: is_dm
      }
    })
    head :ok
  end

  # POST /webhooks/slack/commands
  # /alchemy <slug> <text>      → route to that agent in the calling channel
  # /alchemy <text>             → route to the org's default Slack agent
  # /alchemy help               → ephemeral usage message
  # Slash commands arrive as form-encoded, not JSON.
  def slack_command
    body = request.raw_post
    return head :unauthorized unless valid_slack_signature?(body)

    team_id    = params[:team_id]
    channel_id = params[:channel_id]
    raw_text   = params[:text].to_s.strip
    user_id    = params[:user_id]

    install = find_slack_install(team_id: team_id)
    return render_command_ephemeral("Sentrel isn't installed in this workspace yet.") unless install

    if raw_text.downcase == "help" || raw_text.empty?
      return render_command_ephemeral(slack_command_help_text)
    end

    slug, message = raw_text.split(/\s+/, 2)
    agent =
      if message.present? && (a = install.organization.agents.find_by(slug: slug))
        a
      else
        # No slug match — treat the whole text as a message for the default agent.
        message = raw_text
        find_org_default_slack_agent(team_id: team_id)
      end

    return render_command_ephemeral("No agent matched. Try `/alchemy <agent-slug> <message>` or set a default in /settings.") unless agent

    enqueue(agent, "slack", {
      from: user_id,
      body: message,
      metadata: {
        channel: channel_id,
        thread_ts: nil,
        ts: nil,
        event_type: "slash_command",
        team_id: team_id,
        is_dm: channel_id.to_s.start_with?("D")
      }
    })

    # 200 with an ephemeral ack so Slack doesn't show "/alchemy failed" while
    # the agent thinks. The actual reply lands separately via deliverSlackReply.
    render json: {
      response_type: "ephemeral",
      text: "✓ #{agent.name} is on it."
    }
  end

  # POST /webhooks/slack/interactivity
  # Block Kit button clicks (Approve / Reject on an approval card, future
  # DM picker selections) route here. Slack POSTs form-encoded with a
  # single `payload=<json>` field. Signature verification on raw body is
  # still required.
  def slack_interactivity
    body = request.raw_post
    return head :unauthorized unless valid_slack_signature?(body)

    payload = JSON.parse(params[:payload].to_s) rescue {}
    actions = Array(payload["actions"])
    return head :ok if actions.empty?

    action    = actions.first
    action_id = action["action_id"].to_s

    case action_id
    when /\Aapproval:(approve|reject):(\d+)\z/
      decision = Regexp.last_match(1)
      approval_id = Regexp.last_match(2).to_i
      handle_approval_decision(payload, approval_id, decision)
    when /\Adm_pick_agent:(\d+)\z/
      agent_id = Regexp.last_match(1).to_i
      handle_dm_picker(payload, agent_id)
    end

    head :ok
  end

  # Multi-agent Slack routing: exact (team_id, channel_id) match wins. We do
  # NOT fall back to team_id-only — an unmapped channel/DM should be a no-op
  # rather than spamming a random agent in the org.
  def find_slack_agent(team_id:, channel_id:)
    return nil if team_id.blank? || channel_id.blank?
    ChannelConfig
      .where(channel_type: "slack", enabled: true)
      .where("config->>'team_id' = ?", team_id)
      .where("config->>'slack_channel_id' = ?", channel_id)
      .first
      &.agent
  end

  # DM routing: same lookup, but specifically against `slack_dm_channel_id`
  # which is populated when an agent and a user have an established DM.
  # We persist the binding on first DM, so subsequent DMs from the same user
  # land on the same agent without prompting.
  def find_slack_dm_agent(team_id:, im_channel_id:)
    return nil if team_id.blank? || im_channel_id.blank?
    ChannelConfig
      .where(channel_type: "slack", enabled: true)
      .where("config->>'team_id' = ?", team_id)
      .where("config->>'slack_dm_channel_id' = ?", im_channel_id)
      .first
      &.agent
  end

  # Fallback for an unbound DM: route to the org's designated front-desk
  # agent (set on /settings). Returns nil if no default is configured —
  # caller is responsible for prompting the user via respond_with_dm_picker.
  def find_org_default_slack_agent(team_id:)
    return nil if team_id.blank?
    install = find_slack_install(team_id: team_id)
    return nil unless install&.organization&.default_slack_agent_id
    install.organization.agents.find_by(id: install.organization.default_slack_agent_id)
  end

  # Find ANY enabled Slack ChannelConfig for the workspace. The bot_token +
  # signing_secret live on this row and are shared across every agent in
  # the org (one workspace = one bot install).
  def find_slack_install(team_id:)
    return nil if team_id.blank?
    ChannelConfig
      .where(channel_type: "slack", enabled: true)
      .where("config->>'team_id' = ?", team_id)
      .first
  end

  # DM picker — when the user DMs the bot but no agent is bound, post a
  # Block Kit message listing the org's agents so they can pick one.
  # Future improvement: persist the picked agent as the user's binding on
  # the ChannelConfig so they don't get prompted again.
  def respond_with_dm_picker(team_id:, channel:)
    install = find_slack_install(team_id: team_id)
    return unless install

    agents = install.organization.agents.where.not(role: nil).order(:name).limit(10)
    return if agents.empty?

    blocks = [
      { type: "section",
        text: { type: "mrkdwn",
                text: "Hey! Which agent would you like to talk to? Pick one and your next message will go to them." } },
      { type: "actions",
        elements: agents.map { |a|
          {
            type: "button",
            text: { type: "plain_text", text: a.name },
            value: a.id.to_s,
            action_id: "dm_pick_agent:#{a.id}"
          }
        } }
    ]
    Slack::Api.post_message(
      token: install.secrets["bot_token"],
      channel: channel,
      text: "Pick an agent to talk to",
      blocks: blocks,
    )
  end

  # Help text shown for `/alchemy` with no args or `/alchemy help`.
  def slack_command_help_text
    <<~HELP
      *Sentrel slash command*
      `/alchemy <agent-slug> <message>` — send a message to a specific agent
      `/alchemy <message>` — send to your org's default Slack agent (set in /settings)
      `/alchemy help` — show this

      The agent replies in the same channel you typed the command from.
      To set a default agent, open https://www.sentrel.ai/settings.
    HELP
  end

  # Slash-command ephemeral response — only the user who typed sees it.
  def render_command_ephemeral(text)
    render json: { response_type: "ephemeral", text: text }
  end

  # Interactivity handler — Approve/Reject from a Block Kit card.
  # Match the clicking user to an org member by email (via users.info on
  # the Slack side, cached short-term) so `reviewed_by` is populated.
  # Falls back to nil if the Slack user has no matching email in our DB.
  def handle_approval_decision(payload, approval_id, decision)
    approval = PendingApproval.find_by(id: approval_id)
    return unless approval && approval.status == "pending"

    slack_user_id = payload.dig("user", "id")
    team_id       = payload.dig("team", "id")
    install       = find_slack_install(team_id: team_id)
    reviewer      = resolve_org_user_from_slack(install: install, slack_user_id: slack_user_id)

    new_status = decision == "approve" ? "approved" : "rejected"
    approval.update!(
      status: new_status,
      decision: decision,
      reviewed_by: reviewer,
      reviewed_at: Time.current,
    )

    # Engine-side notification: same Redis pub/sub flow the web UI uses.
    if approval.payload_type.present? && approval.approval_token.present?
      publish_approval_to_engine(approval)
    elsif new_status == "approved" && approval.tool_name == "send_email"
      SendEmailJob.perform_later(
        approval.tool_input.merge(
          "agent_id" => approval.agent_id,
          "org_id" => approval.organization_id,
        ),
      )
    end

    # Edit the card to show the decision + drop the buttons.
    Slack::ApprovalCard.update_after_decision(approval)
  end

  # Match the Slack user (U…) to one of the org's Users by email so the
  # PendingApproval gets attributed. lookupByEmail in reverse — we ask
  # Slack for the user's email by their U-id, then look that email up
  # in our DB. Cached in Redis for 1h to avoid hammering users.info.
  def resolve_org_user_from_slack(install:, slack_user_id:)
    return nil unless install && slack_user_id.present?

    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0")) rescue nil
    cache_key = "slack:user_email:#{slack_user_id}"
    cached = redis&.get(cache_key)

    email = cached.presence || begin
      uri = URI.parse("https://slack.com/api/users.info?user=#{slack_user_id}")
      req = Net::HTTP::Get.new(uri)
      req["Authorization"] = "Bearer #{install.secrets['bot_token']}"
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 5) { |http| http.request(req) }
      data = JSON.parse(res.body)
      addr = data.dig("user", "profile", "email")
      redis&.set(cache_key, addr.to_s, ex: 3600) if addr
      addr
    end

    # Match against everyone who belongs to this org (membership-based), not
    # just users whose active org is currently this one.
    install.organization.members.find_by("LOWER(email) = ?", email.to_s.downcase) if email.present?
  rescue StandardError => e
    Rails.logger.warn "[Slack interactivity] resolve_org_user_from_slack failed: #{e.message}"
    nil
  end

  # Publish the user's decision back into the engine's per-agent approval
  # channel so the request_approval tool's await unblocks. Mirrors the
  # publish_action_approval method on PendingApprovalsController — we
  # don't reach into that controller's private API because cross-controller
  # plumbing is fragile.
  def publish_approval_to_engine(approval)
    msg = {
      type: "action_approval_response",
      approvalToken: approval.approval_token,
      value: approval.decision,
      text: approval.decision_text
    }.to_json
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    redis.publish("agent-#{approval.agent_id}-approvals", msg)
  rescue StandardError => e
    Rails.logger.error "[Slack interactivity] approval publish failed: #{e.message}"
  end

  # DM picker click — user selected an agent to talk to. Persist the
  # binding on the agent's ChannelConfig so future DMs from the same user
  # land on the same agent without prompting.
  def handle_dm_picker(payload, agent_id)
    team_id    = payload.dig("team", "id")
    channel_id = payload.dig("channel", "id") || payload.dig("container", "channel_id")
    agent      = Agent.find_by(id: agent_id)
    return unless agent && channel_id.present?

    cc = agent.channel_configs.find_by(channel_type: "slack")
    return unless cc
    cc.config = (cc.config || {}).merge("slack_dm_channel_id" => channel_id)
    cc.save!

    install = find_slack_install(team_id: team_id)
    return unless install
    Slack::Api.post_message(
      token: install.secrets["bot_token"],
      channel: channel_id,
      text: "✓ Linked this DM to #{agent.name}. Just send a message — they'll reply right here.",
    )
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
      metadata: { message_sid: params[:MessageSid], num_media: params[:NumMedia] }
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
      metadata: { message_sid: params[:MessageSid] }
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
      metadata: { chat_id: chat_id, message_id: message[:message_id] }
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
        byte_size: blob.byte_size
      }
    end

    enqueue(agent, "web", {
      from: current_user.email,
      from_name: current_user.name,
      body: params[:body].to_s,
      attachment_ids: attachment_signed_ids,
      attachments: attachments_payload,
      conversationId: conversation.id,
      user_id: current_user.id
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
      body: params[:text] || params[:body] || params[:html]
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

  # Slack signs every request with HMAC-SHA256 over `v0:{ts}:{body}` using the
  # signing_secret. Reject replays > 5 min old. Skip in dev when no secret set.
  def valid_slack_signature?(body)
    secret = ENV["SLACK_SIGNING_SECRET"]
    return true if secret.blank? && !Rails.env.production?
    return false if secret.blank?

    ts = request.headers["X-Slack-Request-Timestamp"].to_s
    sig = request.headers["X-Slack-Signature"].to_s
    return false if ts.blank? || sig.blank?
    return false if (Time.now.to_i - ts.to_i).abs > 300  # replay guard

    base = "v0:#{ts}:#{body}"
    digest = OpenSSL::HMAC.hexdigest("SHA256", secret, base)
    expected = "v0=#{digest}"
    ActiveSupport::SecurityUtils.secure_compare(expected, sig)
  end

  # Idempotency for Slack retries. Returns true if we've already seen the
  # event_id within the TTL window — caller should ack 200 and skip work.
  def slack_event_seen?(event_id)
    return false if event_id.blank?
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    key = "slack:event:#{event_id}"
    # SETNX with 5-min TTL — first writer wins, retries find the key and return true.
    res = redis.set(key, "1", nx: true, ex: 300)
    !res  # SETNX returns true on first write; we want "seen?" semantics inverted
  rescue StandardError => e
    Rails.logger.warn "[Slack webhook] dedup check failed: #{e.message}"
    false
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
      # Owners/admins are identified by their membership role in THIS org
      # (users.role tracks the active org, which may be a different one).
      auto_claim_user = organization.memberships.where(role: %w[owner admin]).order(:id).first&.user
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
                end
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
