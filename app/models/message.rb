class Message < ApplicationRecord
  has_prefix_id :msg
  include PublicIdSerialization

  belongs_to :conversation
  belongs_to :sender_user, class_name: "User", foreign_key: :sender_user_id, optional: true
  has_many_attached :attachments

  validates :role, presence: true, inclusion: { in: %w[user assistant system] }
  # Content can be empty when the message has attachments (file-only sends)
  # or media (voice notes, image-only). Without this exemption, the webhook
  # 500s on every file-only inbound and the message never reaches the engine.
  validate :content_or_attachments_present

  # Push assistant replies to the browser in real time via ActionCable.
  # Frontend subscribes to AgentChatChannel per agent_id and appends new
  # messages as they arrive — no more "refresh to see" UX in production.
  after_create_commit :broadcast_to_chat, if: -> { role == "assistant" && content.present? }

  # Resolves who actually sent this message — used by chat + inbox renderers
  # to show "Casper <casper@…>" instead of "me". Falls back to the conversation's
  # agent for assistant rows the engine wrote without populating the new columns
  # (those land before the migration backfill runs in production).
  def display_sender
    name  = sender_name.presence
    email = sender_email.presence
    if (name.nil? || email.nil?) && role == "assistant"
      agent = conversation&.agent
      name  ||= agent&.name
      email ||= agent&.primary_email_address
    end
    {
      name:  name,
      email: email,
      kind:  sender_kind,
    }
  end

  def sender_kind
    return :user     if sender_user_id.present?
    return :agent    if role == "assistant"
    return :external if direction == "inbound" && channel == "email"
    role == "user" ? :user : :agent
  end

  private

  def content_or_attachments_present
    return if content.present?
    return if attachments.attached?
    has_media = metadata.is_a?(Hash) && (
      metadata["attachment_ids"].present? ||
      metadata[:attachment_ids].present? ||
      metadata["media"].present? ||
      metadata[:media].present?
    )
    return if has_media
    errors.add(:base, "Message must have content or an attachment")
  end

  def broadcast_to_chat
    agent = conversation&.agent
    return unless agent
    AgentChatChannel.broadcast_assistant_message(agent, self)
  end
end
