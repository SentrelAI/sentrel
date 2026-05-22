class SkillDefinition < ApplicationRecord
  VISIBILITIES = %w[private org marketplace].freeze
  SLUG_REGEX = /\A[a-z][a-z0-9-]{1,63}\z/

  # NOT acts_as_tenant — system seeds (organization_id NULL) need to be
  # visible across every org, and acts_as_tenant's default scope filters
  # them out regardless of `optional: true`. Use the explicit visible_to(org)
  # scope instead of relying on a global default scope.
  belongs_to :organization, optional: true
  belongs_to :created_by_user, class_name: "User", optional: true

  has_many :agent_skills, dependent: :destroy
  has_many :agents, through: :agent_skills
  has_many :skill_files, dependent: :destroy, inverse_of: :skill_definition

  validates :slug, presence: true, uniqueness: true, format: { with: SLUG_REGEX, message: "must be lowercase letters, digits, hyphens" }
  validates :name, presence: true
  validates :visibility, inclusion: { in: VISIBILITIES }
  validate  :skill_md_or_files_present

  scope :built_in,         -> { where(source: "built_in") }
  scope :system_skills,    -> { where(source: "built_in", visibility: "marketplace", published: true) }
  scope :marketplace,      -> { where(visibility: "marketplace", published: true) }
  scope :org_visible,      ->(org) {
    where(organization_id: org&.id).where("(visibility IN ('org', 'marketplace') AND published = TRUE) OR organization_id = ?", org&.id)
  }
  scope :by_category,      ->(cat) { where(category: cat) }

  # Visible to an org: their own (any state) + marketplace seeds (published)
  # + any other org's marketplace skills they've explicitly chosen to install.
  def self.visible_to(org)
    return marketplace if org.nil?
    where(
      "(organization_id = ?) OR (visibility = 'marketplace' AND published = TRUE)",
      org.id,
    )
  end

  # Returns which required pieces are missing, given an agent's current
  # capabilities + the org's connected Composio toolkits. UI uses this to
  # gray out skills whose requirements aren't met.
  def dependencies_missing_for(agent, available_integration_slugs = [])
    caps_missing = (required_capabilities || []).reject { |k| agent.capability_enabled?(k) }
    ints_missing = (required_integrations || []) - available_integration_slugs.map(&:to_s)
    { capabilities: caps_missing, integrations: ints_missing }
  end

  def dependencies_met_for?(agent, available_integration_slugs = [])
    missing = dependencies_missing_for(agent, available_integration_slugs)
    missing[:capabilities].empty? && missing[:integrations].empty?
  end

  def system?
    source == "built_in"
  end

  def org_owned?
    organization_id.present?
  end

  def editable_by?(user)
    return false unless user
    # Platform admins (ScribeMD operators) can edit any skill — system
    # seeds + cross-tenant — from /admin/skills via the same editor.
    return true if user.respond_to?(:platform_admin?) && user.platform_admin?
    return false if system?
    organization_id == user.organization_id
  end

  def primary_file
    skill_files.where(path: "SKILL.md").first || skill_files.ordered.first
  end

  # Increment install counter atomically. Called when an AgentSkill is created
  # against this definition so the marketplace can show popularity.
  def increment_install_count!
    self.class.where(id: id).update_all("install_count = install_count + 1")
  end

  # Bump the version + flip published to true. Called from the publish action;
  # readers (engine sync, marketplace browse) only see published rows so the
  # editor can be saved freely in draft mode.
  def publish!
    update!(published: true, version: version.to_i + 1)
  end

  def unpublish!
    update!(published: false)
  end

  # Snapshot this skill into a new SkillDefinition owned by another user/org
  # — used by the marketplace "Fork" button so users can customize a public
  # skill without affecting the original.
  def fork_to(user:, organization:, name: nil)
    new_slug = self.class.unique_slug("#{slug}-fork")
    new_def = self.class.create!(
      slug: new_slug,
      name: name.presence || "#{self.name} (fork)",
      description: description,
      category: category,
      icon: icon,
      source: "user_made",
      organization_id: organization.id,
      created_by_user_id: user.id,
      published: false,
      version: 1,
      visibility: "private",
      install_count: 0,
      required_capabilities: required_capabilities,
      required_integrations: required_integrations,
      requires_connections: requires_connections,
      system_prompt_fragment: system_prompt_fragment,
      skill_md: skill_md,
    )
    skill_files.ordered.each do |f|
      new_def.skill_files.create!(
        path: f.path,
        content: f.content,
        file_type: f.file_type,
        position: f.position,
      )
    end
    new_def
  end

  # When the editor saves SKILL.md, sync it back into the legacy skill_md
  # column so the engine's older single-file consumers (and the embeddings
  # index) keep working. The skill_files row is canonical going forward.
  def sync_legacy_skill_md!
    main = skill_files.find_by(path: "SKILL.md")
    return unless main
    update_column(:skill_md, main.content.to_s)
  end

  def self.unique_slug(base)
    s = base.to_s.parameterize.presence || "skill"
    candidate = s
    n = 0
    while where(slug: candidate).exists?
      n += 1
      candidate = "#{s}-#{n}"
      break if n > 50
    end
    candidate = "#{s}-#{SecureRandom.hex(2)}" if where(slug: candidate).exists?
    candidate
  end

  private

  def skill_md_or_files_present
    return if skill_md.present?
    return if skill_files.any? { |f| !f.marked_for_destruction? && f.content.to_s.strip.present? }
    errors.add(:base, "must include SKILL.md content")
  end
end
