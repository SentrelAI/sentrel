class Agent < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :manager, class_name: "Agent", optional: true

  has_one :instance, dependent: :destroy
  has_one :ai_config, dependent: :destroy
  has_many :sub_agents, class_name: "Agent", foreign_key: :manager_id, dependent: :nullify
  has_many :channel_configs, dependent: :destroy
  has_many :conversations, dependent: :destroy
  has_many :tasks, dependent: :destroy
  has_many :scheduled_tasks, dependent: :destroy
  has_many :pending_approvals, dependent: :destroy
  has_many :audit_logs, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: { scope: :organization_id }
  validates :role, presence: true
  validates :status, presence: true, inclusion: { in: %w[pending starting running paused stopped] }
end
