require "mail"

module Email
  # Parses raw email content and SES SNS notifications.
  # Returns a normalized hash with body, headers, attachments.
  class MimeParser
    Result = Struct.new(:body_text, :attachments, :message_id, :in_reply_to, :references, keyword_init: true)

    # Parse a SES SNS notification (Hash) into a normalized result
    def self.parse_ses_notification(ses_notification)
      mail_info = ses_notification["mail"] || {}
      headers = mail_info["headers"] || []

      Result.new(
        body_text: extract_body(ses_notification),
        attachments: extract_attachments(ses_notification),
        message_id: header(headers, "Message-ID") || mail_info["messageId"],
        in_reply_to: header(headers, "In-Reply-To"),
        references: header(headers, "References"),
      )
    end

    def self.extract_cc(ses_notification)
      mail_info = ses_notification["mail"] || {}
      headers = mail_info["headers"] || []

      cc = mail_info.dig("commonHeaders", "cc") || []
      if cc.empty?
        cc_header = header(headers, "Cc")
        cc = cc_header.to_s.split(",").map(&:strip).reject(&:empty?) if cc_header
      end
      cc
    end

    def self.header(headers, name)
      headers.find { |h| h["name"]&.casecmp(name) == 0 }&.dig("value")
    end

    def self.extract_body(ses_notification)
      content = ses_notification["content"]
      return ses_notification.dig("mail", "commonHeaders", "subject").to_s if content.blank?

      mail = Mail.new(content)
      mail.text_part&.decoded || mail.html_part&.decoded || mail.body&.decoded || ""
    rescue => e
      Rails.logger.error "MimeParser body error: #{e.message}"
      ""
    end

    def self.extract_attachments(ses_notification)
      content = ses_notification["content"]
      return [] if content.blank?

      mail = Mail.new(content)
      mail.attachments.reject(&:inline?).map do |att|
        {
          filename: att.filename,
          content_type: att.content_type,
          body: att.body.decoded,
        }
      end
    rescue => e
      Rails.logger.warn "MimeParser attachment error: #{e.message}"
      []
    end
  end
end
