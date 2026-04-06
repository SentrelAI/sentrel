class ScheduledTask < ApplicationRecord
  belongs_to :organization
  belongs_to :agent

  validates :name, presence: true
  validates :instruction, presence: true
  validates :cron_expression, presence: true
end
