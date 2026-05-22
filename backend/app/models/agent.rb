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
  has_many :approval_rules, dependent: :destroy
  has_many :audit_logs, dependent: :destroy
  has_many :agent_skills, dependent: :destroy
  has_many :skill_definitions, through: :agent_skills
  has_many :agent_tool_policies, dependent: :destroy
  has_many :agent_credential_grants, dependent: :destroy
  has_many :credentials, through: :agent_credential_grants
  has_many :agent_summaries, dependent: :destroy

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

  # Composio toolkit slugs the agent's CURRENTLY-ENABLED skills depend on.
  # Driven by SkillDefinition.requires_connections so it stays correct as
  # the user toggles skills on/off — no template lookup needed.
  def required_integration_slugs
    skill_definitions.joins(:agent_skills)
                     .where(agent_skills: { enabled: true })
                     .pluck(:requires_connections)
                     .flatten
                     .map(&:to_s)
                     .reject(&:blank?)
                     .uniq
  end

  # Slugs the agent's skills require but the org hasn't connected yet.
  # Empty array if the org has all of them OR the agent's skills require
  # none.
  def missing_integration_slugs
    return [] unless organization
    connected = organization.integrations.pluck(:service_name).map { |s| s.to_s.downcase }.to_set
    required_integration_slugs.reject { |slug| connected.include?(slug.downcase) }
  end

  # First enabled email channel address — the agent's outward identity for
  # outbound mail and the "From" label on the agent's own messages.
  def primary_email_address
    @primary_email_address ||= channel_configs
      .where(channel_type: "email", enabled: true)
      .order(:id)
      .first
      &.config
      &.dig("address")
  end
end
