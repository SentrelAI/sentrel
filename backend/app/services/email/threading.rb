module Email
  # Single source of truth for email thread lookup.
  # Tries: in_reply_to → contact + clean subject → subject only → create new.
  module Threading
    module_function

    # Find an existing email thread or create a new one for the agent.
    #
    # `references` is the raw References header value (RFC 5322) — a
    # space-separated list of all ancestor Message-IDs. Passing it in is
    # what rescues the thread when the immediate In-Reply-To points at a
    # message we never received (e.g. the user forwarded from a personal
    # account, or replied via a side address that isn't the agent).
    def find_or_create(agent:, contact_email:, contact_name:, subject:, in_reply_to: nil, references: nil)
      clean_name = contact_name&.gsub(/<[^>]+>/, "")&.strip || contact_email

      # 1. Match by In-Reply-To header (most reliable, RFC 5322)
      if in_reply_to.present?
        existing = agent.conversations.joins(:messages)
          .where(kind: "external")
          .where("messages.metadata->>'message_id' = ?", in_reply_to)
          .first
        return existing if existing
      end

      # 2. Walk the References chain. Earlier IDs in the chain anchor to
      # ancestors deeper in the thread; matching any one of them is enough
      # to splice this email into the existing conversation. Critical when
      # the direct In-Reply-To target wasn't routed through this agent.
      if references.present?
        ref_ids = references.scan(/<[^>]+>/).uniq
        ref_ids.reverse_each do |ref_id|
          existing = agent.conversations.joins(:messages)
            .where(kind: "external")
            .where("messages.metadata->>'message_id' = ?", ref_id)
            .first
          return existing if existing
        end
      end

      # 3. Match by clean subject + contact
      clean_subject = subject&.gsub(/^(Re|Fwd|Fw):\s*/i, "")&.strip
      if clean_subject.present?
        existing = agent.conversations
          .where(kind: "external")
          .where("contact_identifier = ? OR contact_email = ?", contact_email, contact_email)
          .where("subject ILIKE ?", "%#{clean_subject}%")
          .order(updated_at: :desc)
          .first
        return existing if existing

        # 4. Subject-only match (handles CC chains where the new sender
        # has no contact_email match on the existing conversation). Only
        # safe for distinctive subjects — short ones like "hi", "thanks",
        # "ok" used to merge unrelated threads into one and mislabel the
        # sender. Require ≥10 characters of meaningful subject.
        if clean_subject.length >= 10
          existing = agent.conversations
            .where(kind: "external")
            .where("subject ILIKE ?", clean_subject)
            .order(updated_at: :desc)
            .first
          return existing if existing
        end
      end

      # 5. Create new
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
