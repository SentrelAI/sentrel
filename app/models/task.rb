class Task < ApplicationRecord
  STATUSES = %w[todo in_progress awaiting_input done failed cancelled].freeze

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  belongs_to :assigned_by_user, class_name: "User", optional: true
  belongs_to :assigned_by_agent, class_name: "Agent", optional: true
  # Step 4 — the task's dedicated chat thread. Optional during the dual-write
  # rollout window; backfill rake populates for existing rows.
  belongs_to :conversation, optional: true

  has_many :comments, class_name: "TaskComment", dependent: :destroy

  validates :title, presence: true
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :priority, presence: true, inclusion: { in: %w[low normal high urgent] }
end
