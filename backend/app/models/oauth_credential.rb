# Subscription / OAuth credentials for the org.
#
# kind = "ai_provider":
#   The org connected their Anthropic Pro/Max/Team or ChatGPT Plus/Pro/Business
#   account. Tokens are used by agent_provisioner.env_for to authenticate the
#   engine to the LLM provider — they are NEVER exposed to agents as MCP tools.
#
# kind = "tool" (future):
#   For OAuth-based tool integrations.
class OauthCredential < ApplicationRecord
  PROVIDERS = %w[anthropic openai].freeze
  KINDS     = %w[ai_provider tool].freeze

  acts_as_tenant :organization
  belongs_to :organization

  encrypts :access_token_ciphertext, deterministic: false
  encrypts :refresh_token_ciphertext, deterministic: false

  validates :provider, presence: true, inclusion: { in: PROVIDERS }
  validates :kind, presence: true, inclusion: { in: KINDS }
  validates :provider, uniqueness: { scope: :organization_id }

  # Convenience accessors so callers can write `cred.access_token` instead of
  # `cred.access_token_ciphertext`. The `_ciphertext` column name is just to
  # signal "encrypted at rest" in schema readers.
  def access_token
    access_token_ciphertext
  end

  def access_token=(val)
    self.access_token_ciphertext = sanitize_token_value(val)
  end

  def refresh_token
    refresh_token_ciphertext
  end

  def refresh_token=(val)
    self.refresh_token_ciphertext = sanitize_token_value(val)
  end

  def expired?(skew_seconds: 60)
    return true if expires_at.nil?
    expires_at < Time.current + skew_seconds
  end

  def expiring_soon?(within: 1.hour)
    expires_at.present? && expires_at < (Time.current + within)
  end

  private

  def sanitize_token_value(val)
    return nil if val.nil?

    val.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").gsub(/[[:space:]]+/, "")
  end
end
