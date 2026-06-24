# Per-(org, provider) connection policy + BYO-OAuth-app credentials.
# A missing row means the org uses the default "managed" mode (Sentrel's
# shared Nango integration). See the migration for the mode semantics.
class OrgIntegrationConfig < ApplicationRecord
  MODES = %w[managed byo_oauth byo_token].freeze

  acts_as_tenant :organization
  belongs_to :organization

  encrypts :client_secret_ciphertext, deterministic: false

  validates :provider, presence: true, uniqueness: { scope: :organization_id }
  validates :mode, presence: true, inclusion: { in: MODES }
  validate  :byo_oauth_has_credentials

  # Clean accessor over the `_ciphertext` column (the suffix just flags
  # "encrypted at rest" to schema readers).
  def client_secret
    client_secret_ciphertext
  end

  def client_secret=(val)
    self.client_secret_ciphertext = val.presence
  end

  # The connect mode for a provider in an org, defaulting to managed when no
  # row exists. Use this instead of instantiating directly.
  def self.mode_for(organization_id, provider)
    where(organization_id: organization_id, provider: provider).pick(:mode) || "managed"
  end

  # The per-connection OAuth overrides Nango expects for BYO-OAuth, or nil.
  def oauth_overrides
    return nil unless mode == "byo_oauth" && client_id.present?
    {
      oauth_client_id_override: client_id,
      oauth_client_secret_override: client_secret
    }
  end

  private

  def byo_oauth_has_credentials
    return unless mode == "byo_oauth"
    errors.add(:client_id, "is required for bring-your-own OAuth") if client_id.blank?
    errors.add(:client_secret, "is required for bring-your-own OAuth") if client_secret.blank?
  end
end
