class SkillDefinition < ApplicationRecord
  has_many :agent_skills, dependent: :destroy
  has_many :agents, through: :agent_skills

  validates :slug, presence: true, uniqueness: true
  validates :name, presence: true
  validates :skill_md, presence: true

  scope :built_in, -> { where(source: "built_in") }
  scope :by_category, ->(cat) { where(category: cat) }
end
