class Agent < ApplicationRecord
  has_prefix_id :agt
  include PublicIdSerialization

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :manager, class_name: "Agent", optional: true

  has_one :instance, dependent: :destroy
  has_one :ai_config, dependent: :destroy
  has_many :sub_agents, class_name: "Agent", foreign_key: :manager_id, dependent: :nullify
  has_many :channel_configs, dependent: :destroy
  has_many :conversations, dependent: :destroy
  has_many :tasks, dependent: :destroy
  has_many :scheduled_work, dependent: :destroy
  has_many :pending_approvals, dependent: :destroy
  has_many :audit_logs, dependent: :destroy
  has_many :agent_skills, dependent: :destroy
  has_many :skill_definitions, through: :agent_skills
  has_many :agent_tool_policies, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: { scope: :organization_id }
  validates :role, presence: true
  validates :status, presence: true, inclusion: { in: %w[pending starting running paused stopped] }

  DEFAULT_CAPABILITIES = {
    "knowledge_base" => {
      "enabled" => false,
      "always_retrieve" => true,
      "threshold" => 0.75,
      "top_k" => 5
    },
    "scheduling"   => { "enabled" => true },
    "tasks"        => { "enabled" => true },
    "integrations" => { "enabled" => true },
    "recall"       => { "enabled" => true },
    "send_media"   => { "enabled" => true }
  }.freeze

  def effective_capabilities
    DEFAULT_CAPABILITIES.deep_merge(capabilities || {})
  end

  def capability_enabled?(key)
    effective_capabilities.dig(key.to_s, "enabled") == true
  end
end
