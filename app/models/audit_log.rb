class AuditLog < ApplicationRecord
  belongs_to :organization
  belongs_to :agent, optional: true

  validates :action, presence: true
end
