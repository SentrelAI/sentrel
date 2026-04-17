class ScheduledWork < ApplicationRecord
  self.table_name = "scheduled_work"

  MODES = %w[cron once interval].freeze

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent

  validates :name, presence: true
  validates :instruction, presence: true
  validates :mode, presence: true, inclusion: { in: MODES }
  validates :cron_expression, presence: true, if: -> { mode == "cron" }
  validates :fire_at, presence: true, if: -> { mode == "once" }
  validates :interval_seconds, presence: true, numericality: { greater_than: 0 }, if: -> { mode == "interval" }

  scope :active, -> { where(active: true) }
  scope :cron_jobs, -> { where(mode: "cron") }
  scope :one_shots, -> { where(mode: "once") }
  scope :intervals, -> { where(mode: "interval") }
end
