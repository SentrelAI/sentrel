class Conversation < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  belongs_to :user, optional: true

  has_many :messages, dependent: :destroy

  validates :kind, presence: true, inclusion: { in: %w[internal external] }
  validates :status, presence: true, inclusion: { in: %w[active archived closed] }
end
