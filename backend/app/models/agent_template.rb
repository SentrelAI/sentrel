class AgentTemplate < ApplicationRecord
  acts_as_tenant :organization, optional: true
  belongs_to :organization, optional: true
  belongs_to :created_by_user, class_name: "User", optional: true
  # Immutable snapshots — every Publish creates a new one. current_version
  # is the head used by the install flow and the show page by default.
  has_many   :versions, -> { ordered }, class_name: "AgentTemplateVersion", dependent: :destroy
  belongs_to :current_version, class_name: "AgentTemplateVersion", optional: true

  validates :slug, presence: true, uniqueness: true
  validates :name, presence: true
  validates :role, presence: true

  CATEGORIES = %w[starter sales support marketing engineering people personal ops].freeze

  scope :system,         -> { where(system_template: true) }
  scope :user_published, -> { where(system_template: false, published: true) }
  # Curated highlights for the public /templates gallery. Ordered by
  # featured_position (NULLS last), then name.
  scope :featured, -> { where(featured: true).order(Arel.sql("featured_position ASC NULLS LAST"), :name) }

  # Templates an org's user is allowed to see — system seeds (no org), plus
  # templates from their own org. Combined with `published` so unfinished
  # private drafts (created via "Save as template" but not yet shared) don't
  # leak across teammates.
  scope :visible_to, ->(org) {
    where(published: true).where("organization_id IS NULL OR organization_id = ?", org&.id)
  }

  # Variable names the UI may surface to the user at create time. Others
  # (agent_name, company_name, user_name) are filled in automatically.
  def render(vars = {})
    ctx = {
      "agent_name"   => vars[:agent_name]   || vars["agent_name"]   || name,
      "company_name" => vars[:company_name] || vars["company_name"] || "the company",
      "user_name"    => vars[:user_name]    || vars["user_name"]    || "the user",
      "role"         => vars[:role]         || vars["role"]         || role
    }.merge(vars.transform_keys(&:to_s))

    {
      identity_md:     substitute(identity_md,     ctx),
      personality_md:  substitute(personality_md,  ctx),
      instructions_md: substitute(instructions_md, ctx)
    }
  end

  # Snapshot an agent's current configuration into a fresh template row owned
  # by the actor's org / user. Bundles skill slugs, integration service names,
  # capabilities, and the signature so the recipient gets the same toolbox +
  # voice at install time. Credential grants are intentionally NOT copied —
  # secrets are org-private; the recipient picks their own.
  def self.snapshot_from(agent, user:, name:, category: nil, description: nil, published: false)
    slug = unique_slug_for(name, agent.organization_id, user.id)

    integrations_used = if agent.organization
      agent.organization.integrations.pluck(:service_name).uniq
    else
      []
    end

    create!(
      slug: slug,
      name: name,
      role: agent.role,
      description: description.presence || "Saved from #{agent.name}",
      icon: nil,
      organization_id: agent.organization_id,
      created_by_user_id: user.id,
      system_template: false,
      published: published,
      category: category.presence || "starter",
      identity_md: agent.identity_md,
      personality_md: agent.personality_md,
      instructions_md: agent.instructions_md,
      email_signature_md: agent.email_signature_md,
      capabilities: agent.capabilities.presence || {},
      suggested_skill_slugs: agent.skill_definitions.pluck(:slug),
      suggested_integrations: integrations_used,
      suggested_manager_role: agent.manager&.role,
      suggested_provider: agent.ai_config&.provider.presence || "anthropic",
      suggested_model: agent.ai_config&.model_id,
      variables: [],
    )
  end

  # Integration service names this template expects to be connected. The
  # new-agent flow can surface these as a "Connect these to fully enable this
  # agent" hint after creation — we don't auto-connect because Composio
  # requires user-driven OAuth.
  def missing_integrations_for(org)
    return [] if suggested_integrations.blank?
    connected = org.integrations.pluck(:service_name).map(&:downcase).to_set
    suggested_integrations.reject { |s| connected.include?(s.to_s.downcase) }
  end

  # Atomic counter — bumped when a user installs this template.
  def increment_installs!
    update_column(:install_count, install_count.to_i + 1)
  end

  # Lightweight fields for browse/deploy cards — the public /templates
  # gallery and the no-agent empty-state picker. Kept here so both callers
  # render the same shape (name, summary, author, badge) without each
  # re-deriving the author label.
  def card_attributes
    {
      slug: slug,
      name: name,
      role: role,
      description: description,
      icon: icon,
      category: category,
      system_template: system_template,
      featured: featured,
      featured_position: featured_position,
      install_count: install_count,
      author_name: system_template ? "Sentrel" : (created_by_user&.name.presence || "Workspace member")
    }
  end

  private

  def substitute(text, ctx)
    return nil if text.blank?
    text.gsub(/\{\{\s*(\w+)\s*\}\}/) { ctx[Regexp.last_match(1)] || "" }
  end

  # Ensures the slug is globally unique even when two orgs save "Meeting
  # Manager" simultaneously. Falls back to a short random suffix on
  # collision. Keep the human-readable prefix so /templates URLs stay nice.
  def self.unique_slug_for(name, org_id, user_id)
    base = name.to_s.parameterize.presence || "template"
    candidate = base
    suffix = 0
    while where(slug: candidate).exists?
      suffix += 1
      candidate = "#{base}-#{suffix}"
      break if suffix > 50
    end
    if where(slug: candidate).exists?
      candidate = "#{base}-#{org_id}-#{user_id}-#{SecureRandom.hex(2)}"
    end
    candidate
  end
end
