class ScheduledTask < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent

  validates :name, presence: true
  validates :instruction, presence: true
  validates :cron_expression, presence: true
end
