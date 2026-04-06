class ChannelConfig < ApplicationRecord
  belongs_to :agent

  validates :channel_type, presence: true, uniqueness: { scope: :agent_id }
  validates :status, presence: true, inclusion: { in: %w[connected disconnected error] }
end
