class AgentTemplateVersion < ApplicationRecord
  # Immutable. Every "Publish to community" action creates a new row;
  # never updated in place. Corrections happen by publishing again.
  belongs_to :agent_template
  belongs_to :created_by_user, class_name: "User", optional: true

  validates :version_number, presence: true, numericality: { only_integer: true, greater_than: 0 }
  validates :version_number, uniqueness: { scope: :agent_template_id }
  validates :spec_version,   presence: true
  validates :definition,     presence: true
  validate  :definition_is_hash
  validate  :immutable_after_create, on: :update

  scope :ordered, -> { order(version_number: :desc) }

  # Next sequential version number for a template. Caller is expected to be
  # inside the same transaction as the create so two concurrent publishes
  # don't both land on the same number (the unique index is the backstop).
  def self.next_number_for(template)
    where(agent_template_id: template.id).maximum(:version_number).to_i + 1
  end

  # Headline fields the AgentTemplate row mirrors for fast list views.
  # Use these instead of digging into `definition` whenever a list page
  # needs a name / category / description / license / icon.
  def headline
    d = definition || {}
    {
      name:        d["name"],
      role:        d["role"],
      description: d["description"],
      category:    d["category"],
      icon:        d["icon"],
      license:     license.presence || d["license"]
    }.compact
  end

  private

  def definition_is_hash
    return if definition.is_a?(Hash)
    errors.add(:definition, "must be a Hash (got #{definition.class})")
  end

  # Anything other than `published` is locked once the row exists. Publishing
  # a corrected version is the supported workflow; the immutability is what
  # lets users cite "v3 of this template" forever and trust the contents.
  ALLOWED_UPDATE_KEYS = %w[published updated_at].freeze
  def immutable_after_create
    bad = changes.keys - ALLOWED_UPDATE_KEYS
    return if bad.empty?
    errors.add(:base, "version rows are immutable; cannot change #{bad.join(', ')}. Publish a new version instead.")
  end
end
