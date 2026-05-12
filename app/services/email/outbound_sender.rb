require "mail"

module Email
  # Sends an outbound email via SES.
  # Handles: domain verification, suppression check, threading headers,
  # signature appending, attachments, conversation persistence, audit log.
  class OutboundSender
    Result = Struct.new(:status, :message_id, :error, keyword_init: true)

    # Raised when sending fails for a reason that won't be fixed by retrying
    # (invalid recipient, domain not verified, etc.)
    class PermanentFailure < StandardError; end

    SIGNATURE_PATTERN = /\n\s*(--|—)\s*\n|\n(Best|Thanks|Cheers|Regards|Sincerely)[,!.]?\s*\n[A-Z]/i

    # Errors that should be retried by the job
    TRANSIENT_SES_ERRORS = [
      Aws::SES::Errors::Throttling,
      Aws::SES::Errors::ServiceUnavailable,
    ].freeze

    def initialize(payload)
      @payload = payload.with_indifferent_access
      @org = Organization.find(@payload[:org_id])
      @agent = Agent.find(@payload[:agent_id])
      @from_address = @payload[:from_address]
      @from_domain = @from_address&.split("@")&.last
      @to_address = Array(@payload[:to]).first
      @subject = @payload[:subject].presence || "(no subject)"
    end

    def call
      return failure("Domain not verified: #{@from_domain}") unless domain_verified?
      return suppressed if suppressed?

      conversation = Threading.find_or_create(
        agent: @agent,
        contact_email: @to_address,
        contact_name: @to_address,
        subject: @subject,
      )

      threading_headers = build_threading_headers(conversation)
      mail = build_mail(threading_headers)

      ses = SesClient.for(@org)
      # Must pass destinations explicitly — Mail gem strips BCC from raw output
      # (correct MIME behavior), so SES won't see BCC recipients without this.
      all_recipients = Array(@payload[:to]) + Array(@payload[:cc]) + Array(@payload[:bcc])
      all_recipients = all_recipients.compact.reject(&:blank?).uniq
      result = ses.send_raw_email(
        raw_message: { data: mail.to_s },
        destinations: all_recipients,
      )

      save_outbound_message(conversation, threading_headers, result.message_id)
      conversation.update!(subject: @subject) if conversation.subject.blank?
      log_success(result.message_id)

      Result.new(status: :sent, message_id: threading_headers[:new_message_id])
    rescue *TRANSIENT_SES_ERRORS => e
      # Re-raise so the job retries
      log_failure("Transient: #{e.message}")
      raise
    rescue Aws::SES::Errors::ServiceError => e
      # Permanent SES error — don't retry
      log_failure(e.message)
      Result.new(status: :failed, error: e.message)
    end

    private

    def domain_verified?
      @org.email_domain == @from_domain && @org.email_domain_verified
    end

    def suppressed?
      EmailSuppression.suppressed?(@org.id, @to_address.downcase)
    end

    def suppressed
      AuditLog.create!(
        organization: @org, agent: @agent,
        action: "email_suppressed", tool_name: "send_email",
        input: @payload.except(:body_html, :body_text).as_json,
        output: { reason: "Recipient on suppression list (bounce or complaint)" },
        status: "suppressed",
      )
      Result.new(status: :suppressed)
    end

    def failure(error)
      AuditLog.create!(
        organization: @org, agent: @agent,
        action: "email_failed", tool_name: "send_email",
        input: @payload.except(:body_html, :body_text).as_json,
        output: { error: error },
        status: "failed",
      )
      Result.new(status: :failed, error: error)
    end

    def build_threading_headers(conversation)
      last_inbound = conversation.messages
        .where(direction: "inbound", channel: "email")
        .order(created_at: :desc)
        .first

      in_reply_to = last_inbound&.metadata&.dig("message_id")
      prev_references = last_inbound&.metadata&.dig("references")
      references = [prev_references, in_reply_to].compact.join(" ").strip.presence
      new_message_id = "<#{SecureRandom.uuid}@#{@from_domain}>"

      { in_reply_to: in_reply_to, references: references, new_message_id: new_message_id }
    end

    def build_mail(threading_headers)
      payload_with_sig = apply_signature(@payload)
      html_body = HtmlBuilder.build(payload_with_sig)
      text_body = payload_with_sig[:body_text].to_s

      from_addr = @from_address
      from_name = @payload[:from_name]
      to_array = Array(@payload[:to])
      cc_array = Array(@payload[:cc]).compact.reject(&:blank?)
      bcc_array = Array(@payload[:bcc]).compact.reject(&:blank?)
      subject = @subject
      in_reply_to = threading_headers[:in_reply_to]
      references = threading_headers[:references]
      new_message_id = threading_headers[:new_message_id]
      attachment_blobs = load_attachment_blobs

      mail = Mail.new do
        from       "#{from_name} <#{from_addr}>"
        to         to_array
        cc         cc_array if cc_array.any?
        bcc        bcc_array if bcc_array.any?
        subject    subject
        message_id new_message_id

        if in_reply_to
          header["In-Reply-To"] = in_reply_to
          header["References"] = references || in_reply_to
        end

        text_part { body text_body }
        html_part do
          content_type "text/html; charset=UTF-8"
          body html_body
        end
      end

      attachment_blobs.each do |blob|
        mail.add_file(filename: blob.filename.to_s, content: blob.download)
      end

      mail
    end

    def apply_signature(payload)
      body_text_str = payload[:body_text].to_s
      return payload if body_text_str.match?(SIGNATURE_PATTERN)

      signature = @agent.email_signature_md.presence || default_signature
      result = payload.dup
      result[:body_text] = "#{body_text_str}\n\n#{signature}".strip
      if payload[:body_html].present? && payload[:body_html].include?("<")
        result[:body_html] = "#{payload[:body_html]}<br><br>#{signature.gsub("\n", "<br>")}"
      end
      result
    end

    def default_signature
      "--\n#{@agent.name}\n#{@from_address}"
    end

    def load_attachment_blobs
      Array(@payload[:attachment_ids]).filter_map do |signed_id|
        ActiveStorage::Blob.find_signed(signed_id)
      rescue => e
        Rails.logger.warn "Failed to load attachment #{signed_id}: #{e.message}"
        nil
      end
    end

    def save_outbound_message(conversation, threading_headers, ses_message_id)
      acting_user_id = @payload[:acting_user_id].presence
      sender_name = if acting_user_id
        User.where(id: acting_user_id).pick(:name) || @agent.name
      else
        @payload[:from_name].presence || @agent.name
      end
      conversation.messages.create!(
        role: "assistant",
        content: @payload[:body_text].presence || @payload[:body_html] || "",
        direction: "outbound",
        channel: "email",
        sender_name: sender_name,
        sender_email: @from_address,
        sender_user_id: acting_user_id,
        metadata: {
          to: @payload[:to],
          cc: @payload[:cc],
          bcc: @payload[:bcc],
          subject: @subject,
          message_id: threading_headers[:new_message_id],
          in_reply_to: threading_headers[:in_reply_to],
          references: threading_headers[:references],
          ses_message_id: ses_message_id,
          sent_via_agent_by_user: acting_user_id,
        }.compact,
      )
    end

    def log_success(ses_message_id)
      AuditLog.create!(
        organization: @org, agent: @agent,
        action: "email_sent", tool_name: "send_email",
        input: @payload.except(:body_html, :body_text).as_json,
        output: { status: "sent", ses_message_id: ses_message_id },
        status: "success",
      )
      Rails.logger.info "Email sent: #{@from_address} → #{@to_address} (#{@subject})"
    end

    def log_failure(error)
      Rails.logger.error "SES error: #{error}"
      AuditLog.create!(
        organization: @org, agent: @agent,
        action: "email_failed", tool_name: "send_email",
        input: @payload.except(:body_html, :body_text).as_json,
        output: { error: error },
        status: "failed",
      )
    end
  end
end
