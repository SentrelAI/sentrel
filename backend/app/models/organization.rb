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
  has_many :invitations, dependent: :destroy
  has_many :credentials, dependent: :destroy
  has_many :agent_templates, dependent: :destroy

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true
  # Email subdomain is one-org-per-domain globally. SES domain identities
  # are an AWS-account-scoped resource but inbound routing happens by
  # full address (e.g. casper@ext.scribemd.ai), so two orgs sharing the
  # same domain would mean ambiguous inbound delivery for any address
  # they didn't both reserve. Enforce uniqueness here + at the DB level
  # via the partial index in db/migrate/<ts>_add_unique_email_domain.
  validates :email_domain,
            uniqueness: { case_sensitive: false, allow_nil: true, allow_blank: true,
                          message: "is already in use by another organization" }
end
