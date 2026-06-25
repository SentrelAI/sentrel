# An OAuth-connected external MCP server (e.g. Meta's official Ads MCP).
#
# This is a direct connection to a remote MCP endpoint that speaks the MCP OAuth spec
# (RFC 9728 protected resource). We discover its authorization server, run a
# PKCE authorization-code flow to mint a resource-bound access token, store
# the access + refresh tokens encrypted, and hand the agent's engine a fresh
# Bearer token at connect time (refreshing transparently).
#
# Provider-agnostic by design: any MCP that advertises OAuth metadata works —
# Meta today, others tomorrow, with no per-provider code.
class McpServer < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent, optional: true

  encrypts :access_token_ciphertext, deterministic: false
  encrypts :refresh_token_ciphertext, deterministic: false

  validates :name, :slug, :url, presence: true
  validates :slug, uniqueness: { scope: :organization_id }
  validates :transport, inclusion: { in: %w[http sse stdio] }

  scope :connected, -> { where(status: "connected") }

  # Convenience accessors — the `_ciphertext` suffix just flags "encrypted at
  # rest" in schema readers; callers use the clean names.
  def access_token
    access_token_ciphertext
  end

  def access_token=(val)
    self.access_token_ciphertext = strip_bearer(val)
  end

  def refresh_token
    refresh_token_ciphertext
  end

  def refresh_token=(val)
    self.refresh_token_ciphertext = strip_bearer(val)
  end

  def expired?(skew_seconds: 60)
    return false if expires_at.nil? # no expiry recorded → assume valid until a 401 says otherwise
    expires_at < Time.current + skew_seconds
  end

  def connected?
    status == "connected" && access_token.present?
  end

  private

  def strip_bearer(val)
    return nil if val.nil?
    val.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").gsub(/[[:space:]]+/, "")
  end
end
