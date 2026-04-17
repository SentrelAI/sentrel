class AuditLog < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent, optional: true
  belongs_to :task, optional: true

  validates :action, presence: true
end
