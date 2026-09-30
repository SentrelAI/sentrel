# A remote MCP server connected to the workspace (Linear, ScribeMD, Meta Ads…).
#
# auth_mode says where its credentials live:
#   oauth — speaks the MCP OAuth spec (RFC 9728 protected resource). The row
#           holds the shared part (discovered endpoints, resource, scope, the
#           dynamically registered client); each user signs in for themselves
#           and gets an McpConnection with their own tokens.
#   token — a workspace-wide Bearer token on the row itself (pasted, or minted
#           outside the MCP flow like Meta's Facebook Login).
#   none  — a public server that takes no credentials.
#
# Provider-agnostic by design: any MCP that advertises OAuth metadata works,
# with no per-provider code.
class McpServer < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent, optional: true
  has_many :connections, class_name: "McpConnection", dependent: :destroy

  encrypts :access_token_ciphertext, deterministic: false
  encrypts :refresh_token_ciphertext, deterministic: false

  validates :name, :slug, :url, presence: true
  validates :slug, uniqueness: { scope: :organization_id }
  validates :transport, inclusion: { in: %w[http sse stdio] }
  validates :auth_mode, inclusion: { in: %w[oauth token none] }

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

  # Usable by `user`'s runs? OAuth servers are only ever connected per user.
  def connected?(user = nil)
    case auth_mode
    when "none"  then status == "connected"
    when "oauth" then user.present? && connection_for(user)&.usable? == true
    else              status == "connected" && access_token.present?
    end
  end

  def connection_for(user)
    return nil unless user
    connections.find_by(user_id: user.is_a?(User) ? user.id : user)
  end

  # The RFC 8707 resource the tokens are bound to — what discovery reported,
  # falling back to the endpoint URL for rows set up before it was stored.
  def oauth_resource = resource.presence || url

  private

  def strip_bearer(val)
    return nil if val.nil?
    val.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").gsub(/[[:space:]]+/, "")
  end
end
