class AgentSkill < ApplicationRecord
  belongs_to :agent
  belongs_to :skill_definition

  validates :agent_id, uniqueness: { scope: :skill_definition_id }

  scope :enabled, -> { where(enabled: true) }
end
