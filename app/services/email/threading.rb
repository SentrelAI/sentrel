module Email
  # Single source of truth for email thread lookup.
  # Tries: in_reply_to → contact + clean subject → subject only → create new.
  module Threading
    module_function

    # Find an existing email thread or create a new one for the agent.
    def find_or_create(agent:, contact_email:, contact_name:, subject:, in_reply_to: nil)
      clean_name = contact_name&.gsub(/<[^>]+>/, "")&.strip || contact_email

      # 1. Match by In-Reply-To header (most reliable, RFC 5322)
      if in_reply_to.present?
        existing = agent.conversations.joins(:messages)
          .where(kind: "external")
          .where("messages.metadata->>'message_id' = ?", in_reply_to)
          .first
        return existing if existing
      end

      # 2. Match by clean subject + contact
      clean_subject = subject&.gsub(/^(Re|Fwd|Fw):\s*/i, "")&.strip
      if clean_subject.present?
        existing = agent.conversations
          .where(kind: "external")
          .where("contact_identifier = ? OR contact_email = ?", contact_email, contact_email)
          .where("subject ILIKE ?", "%#{clean_subject}%")
          .order(updated_at: :desc)
          .first
        return existing if existing

        # 3. Subject-only match (handles CC chains)
        existing = agent.conversations
          .where(kind: "external")
          .where("subject ILIKE ?", clean_subject)
          .order(updated_at: :desc)
          .first
        return existing if existing
      end

      # 4. Create new
      agent.conversations.create!(
        organization: agent.organization,
        kind: "external",
        contact_identifier: contact_email,
        contact_name: clean_name,
        contact_email: contact_email,
        subject: subject,
        status: "active",
      )
    end
  end
end
