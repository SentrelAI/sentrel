class Task < ApplicationRecord
  has_prefix_id :tsk
  include PublicIdSerialization

  STATUSES = %w[todo in_progress awaiting_input done failed cancelled].freeze

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  belongs_to :assigned_by_user, class_name: "User", optional: true
  belongs_to :assigned_by_agent, class_name: "Agent", optional: true
  # Task's dedicated chat thread. Seeded by tasks_controller#create and
  # used by the engine for session resume.
  belongs_to :conversation, optional: true

  validates :title, presence: true
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :priority, presence: true, inclusion: { in: %w[low normal high urgent] }
end
