module Email
  # Processes an inbound SES email notification end-to-end:
  # parse → find agents → thread → save message + attachments → enqueue to engine.
  class InboundProcessor
    def initialize(ses_notification)
      @notification = ses_notification
      @mail_info = ses_notification["mail"] || {}
      @parsed = MimeParser.parse_ses_notification(ses_notification)
    end

    def call
      # Idempotency: skip if we've already processed this Message-ID
      if @parsed.message_id.present? && already_processed?(@parsed.message_id)
        Rails.logger.info "InboundProcessor: skipping duplicate message_id=#{@parsed.message_id}"
        return
      end

      from = @mail_info["source"]
      from_name = @mail_info.dig("commonHeaders", "from")&.first
      subject = @mail_info.dig("commonHeaders", "subject")
      cc_addresses = MimeParser.extract_cc(@notification)
      destinations = Array(@mail_info["destination"])

      destinations.each do |to_addr|
        agent = find_agent(to_addr)
        next unless agent

        # Other recipients (besides this agent) become "people to keep in the loop"
        other_recipients = destinations - [to_addr]
        effective_cc = (cc_addresses + other_recipients).uniq.reject { |a| a == to_addr }

        conversation = Threading.find_or_create(
          agent: agent,
          contact_email: from,
          contact_name: from_name,
          subject: subject,
          in_reply_to: @parsed.in_reply_to,
        )

        message = create_message(conversation, from, from_name, to_addr, subject, effective_cc)
        attach_files(message)

        Email::Queue.enqueue_inbound(agent, conversation, {
          from: from,
          from_name: from_name,
          to: to_addr,
          cc: effective_cc,
          subject: subject,
          body: @parsed.body_text,
        })
      end
    end

    private

    def already_processed?(message_id)
      Message.where(direction: "inbound", channel: "email")
        .where("metadata->>'message_id' = ?", message_id)
        .exists?
    end

    def find_agent(to_addr)
      ChannelConfig
        .where(channel_type: "email", enabled: true)
        .where("config->>'address' = ?", to_addr)
        .first&.agent
    end

    def create_message(conversation, from, from_name, to_addr, subject, cc)
      conversation.messages.create!(
        role: "user",
        content: @parsed.body_text.presence || subject.presence || "(empty email)",
        direction: "inbound",
        channel: "email",
        sender_name: from_name.presence || from,
        sender_email: from,
        metadata: {
          from: from,
          from_name: from_name,
          to: to_addr,
          cc: cc,
          subject: subject,
          message_id: @parsed.message_id,
          in_reply_to: @parsed.in_reply_to,
          references: @parsed.references,
        },
      )
    end

    def attach_files(message)
      @parsed.attachments.each do |att|
        message.attachments.attach(
          io: StringIO.new(att[:body]),
          filename: att[:filename],
          content_type: att[:content_type],
        )
      end
    end
  end
end
