# One persona edit on an agent: which field changed, the full before/after,
# who made it, and (optionally) why. The record admins browse to see how an
# agent's prompts evolved in the field — and the unit that gets proposed
# upstream to the agent-templates repo when an edit proves itself.
class AgentPersonaRevision < ApplicationRecord
  belongs_to :agent
  belongs_to :organization
  belongs_to :user, optional: true

  FIELDS = %w[identity_md personality_md instructions_md email_signature_md].freeze

  validates :field, inclusion: { in: FIELDS }
  validates :after_text, presence: true

  scope :newest_first, -> { order(created_at: :desc) }

  def proposed? = proposed_pr_url.present?
end
