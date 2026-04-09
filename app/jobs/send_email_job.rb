class SendEmailJob < ApplicationJob
  queue_as :default

  def perform(payload)
    payload = payload.with_indifferent_access
    org = Organization.find(payload[:org_id])
    agent = Agent.find(payload[:agent_id])

    from_address = payload[:from_address]
    from_domain = from_address&.split("@")&.last

    unless org.email_domain == from_domain && org.email_domain_verified
      Rails.logger.error "Email domain not verified: #{from_domain}"
      AuditLog.create!(
        organization: org, agent: agent,
        action: "email_failed", tool_name: "send_email",
        input: payload.except(:body_html, :body_text),
        output: { error: "Domain not verified: #{from_domain}" },
        status: "failed"
      )
      return
    end

    ses = Aws::SES::Client.new(region: ENV.fetch("AWS_REGION", "us-east-1"))
    ses.send_email(
      source: "#{payload[:from_name]} <#{from_address}>",
      destination: {
        to_addresses: Array(payload[:to]),
        cc_addresses: Array(payload[:cc]).compact.reject(&:blank?),
        bcc_addresses: Array(payload[:bcc]).compact.reject(&:blank?),
      },
      message: {
        subject: { data: payload[:subject] || "(no subject)" },
        body: {
          text: { data: payload[:body_text] || "" },
          html: { data: build_html_body(payload) },
        },
      }
    )

    # Save outbound message to an email conversation (NOT internal chat)
    email_conversation = Conversation.find_or_create_by!(
      agent_id: agent.id,
      organization_id: org.id,
      kind: "external",
      contact_identifier: Array(payload[:to]).first
    ) do |c|
      c.contact_email = Array(payload[:to]).first
      c.contact_name = Array(payload[:to]).first
      c.subject = payload[:subject]
      c.status = "active"
    end

    email_conversation.messages.create!(
      role: "assistant",
      content: payload[:body_text] || payload[:body_html] || "",
      direction: "outbound",
      channel: "email",
      metadata: {
        to: payload[:to],
        cc: payload[:cc],
        bcc: payload[:bcc],
        subject: payload[:subject],
      }
    )

    AuditLog.create!(
      organization: org, agent: agent,
      action: "email_sent", tool_name: "send_email",
      input: payload.except(:body_html, :body_text).as_json,
      output: { status: "sent" },
      status: "success"
    )

    Rails.logger.info "Email sent: #{from_address} → #{payload[:to]} (#{payload[:subject]})"
  rescue Aws::SES::Errors::ServiceError => e
    Rails.logger.error "SES error: #{e.message}"
    AuditLog.create!(
      organization: Organization.find_by(id: payload[:org_id]),
      agent: Agent.find_by(id: payload[:agent_id]),
      action: "email_failed", tool_name: "send_email",
      input: payload.except(:body_html, :body_text).as_json,
      output: { error: e.message },
      status: "failed"
    )
  end

  private

  def build_html_body(payload)
    # If explicit HTML provided, use it
    return payload[:body_html] if payload[:body_html].present?

    # Convert plain text to styled HTML
    text = payload[:body_text] || ""
    escaped = ERB::Util.html_escape(text)
    # Convert newlines to <br>, preserve double newlines as paragraph breaks
    html_content = escaped
      .gsub(/\n\n/, "</p><p style=\"margin: 0 0 1em 0;\">")
      .gsub(/\n/, "<br>")

    <<~HTML
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
        <p style="margin: 0 0 1em 0;">#{html_content}</p>
      </body>
      </html>
    HTML
  end
end
