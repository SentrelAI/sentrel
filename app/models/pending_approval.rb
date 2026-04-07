class PendingApproval < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  belongs_to :reviewed_by, class_name: "User", optional: true

  validates :tool_name, presence: true
  validates :status, presence: true, inclusion: { in: %w[pending approved rejected] }
end
