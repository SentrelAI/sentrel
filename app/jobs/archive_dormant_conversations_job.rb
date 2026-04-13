class ArchiveDormantConversationsJob < ApplicationJob
  queue_as :default

  # Archives conversations with no messages in the last 30 days.
  # Keeps the conversations table tidy. Next inbound message from the
  # same contact creates a fresh conversation row.
  def perform
    cutoff = 30.days.ago
    archived = Conversation
      .where(status: "active")
      .where("last_message_at < ? OR (last_message_at IS NULL AND updated_at < ?)", cutoff, cutoff)
      .update_all(status: "archived", updated_at: Time.current)

    Rails.logger.info "ArchiveDormantConversationsJob: archived #{archived} conversations" if archived > 0
  end
end
