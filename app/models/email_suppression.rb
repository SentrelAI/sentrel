class EmailSuppression < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization

  REASONS = %w[hard_bounce complaint manual].freeze
  validates :email_address, presence: true, uniqueness: { scope: :organization_id }
  validates :reason, inclusion: { in: REASONS }

  def self.suppressed?(org_id, email)
    where(organization_id: org_id, email_address: email.downcase).exists?
  end
end
