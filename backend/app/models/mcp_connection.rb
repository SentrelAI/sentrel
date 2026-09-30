# One person's OAuth sign-in to an MCP server: their access token (short
# lived, ~1h), their refresh token and its expiry, encrypted at rest. The
# server row holds everything shared (endpoints, registered client, resource,
# scope); this holds what's personal.
#
# Refresh tokens rotate — every refresh returns a new one and invalidates the
# old — so two refreshes racing on one connection would leave the loser with a
# dead token and sign the user out. fresh_access_token! serialises them on the
# row lock.
class McpConnection < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :mcp_server
  belongs_to :user

  encrypts :access_token_ciphertext, deterministic: false
  encrypts :refresh_token_ciphertext, deterministic: false

  STATUSES = %w[connected needs_sign_in].freeze
  validates :status, inclusion: { in: STATUSES }

  scope :usable, -> { where(status: "connected").where.not(access_token_ciphertext: nil) }

  def access_token = access_token_ciphertext
  def access_token=(val)
    self.access_token_ciphertext = val.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").presence
  end

  def refresh_token = refresh_token_ciphertext
  def refresh_token=(val)
    self.refresh_token_ciphertext = val.to_s.strip.presence
  end

  def usable? = status == "connected" && access_token.present?

  def expired?(skew_seconds: 60)
    expires_at.present? && expires_at < Time.current + skew_seconds
  end

  def self.token_digest(token) = Digest::SHA256.hexdigest(token.to_s)

  # A current access token, or nil when the user has to sign in again.
  #
  # rejected_digest: the digest of a token the server just answered 401 to.
  # If the stored token no longer matches it, someone else already refreshed
  # while we waited on the lock — hand that token out instead of spending the
  # (rotated) refresh token a second time. Without it, refresh only when the
  # stored token is expired.
  def fresh_access_token!(rejected_digest: nil)
    token = nil
    with_lock do
      if !usable?
        token = nil
      elsif rejected_digest.present? && self.class.token_digest(access_token) != rejected_digest
        token = access_token
      elsif rejected_digest.blank? && !expired?
        token = access_token
      elsif refresh_token.blank?
        update!(status: "needs_sign_in", last_error: "access token expired and there is no refresh token")
      else
        begin
          Mcp::Oauth.apply_tokens!(self, Mcp::Oauth.refresh!(mcp_server, refresh_token: refresh_token))
          token = access_token
        rescue StandardError => e
          update!(status: "needs_sign_in", last_error: e.message.to_s.first(500))
        end
      end
    end
    token
  end
end
