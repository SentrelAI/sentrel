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
          html: { data: payload[:body_html] || payload[:body_text] || "" },
        },
      }
    )

    # Save outbound message to conversation
    if payload[:conversation_id].present?
      conversation = Conversation.find_by(id: payload[:conversation_id])
      conversation&.messages&.create!(
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
    end

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
end
