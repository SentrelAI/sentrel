class Task < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  belongs_to :assigned_by_user, class_name: "User", optional: true
  belongs_to :assigned_by_agent, class_name: "Agent", optional: true

  validates :title, presence: true
  validates :status, presence: true, inclusion: { in: %w[todo in_progress done failed] }
  validates :priority, presence: true, inclusion: { in: %w[low normal high urgent] }
end
