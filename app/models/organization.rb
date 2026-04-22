class Organization < ApplicationRecord
  has_many :users, dependent: :destroy
  has_many :agents, dependent: :destroy
  has_many :conversations, dependent: :destroy
  has_many :tasks, dependent: :destroy
  has_many :scheduled_work, dependent: :destroy
  has_many :pending_approvals, dependent: :destroy
  has_many :integrations, dependent: :destroy
  has_many :audit_logs, dependent: :destroy
  has_many :agent_summaries, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true
end
