class Message < ApplicationRecord
  belongs_to :conversation
  has_many_attached :attachments

  validates :role, presence: true, inclusion: { in: %w[user assistant system] }
  validates :content, presence: true
end
