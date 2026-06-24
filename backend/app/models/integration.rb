class Integration < ApplicationRecord
  SCOPES = %w[org user].freeze
  CONNECT_MODES = %w[managed byo_oauth byo_token].freeze

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :owner_user, class_name: "User", optional: true

  validates :service_name, presence: true
  validates :scope, presence: true, inclusion: { in: SCOPES }
  validates :status, presence: true, inclusion: { in: %w[pending connected disconnected expired error] }
  validates :connect_mode, presence: true, inclusion: { in: CONNECT_MODES }
  validate  :owner_user_consistent_with_scope

  scope :org_wide, -> { where(scope: "org") }
  scope :owned_by, ->(user) { where(scope: "user", owner_user_id: user.id) }
  scope :connected, -> { where(status: "connected") }
  scope :nango_backed, -> { where.not(connect_mode: "byo_token") }

  # True when this app is connected by a pasted token/key rather than an OAuth
  # connection in Nango. The Nango proxy resolves a Credential for these.
  def byo_token?
    connect_mode == "byo_token"
  end

  # Composio's user_id partitions connections by tenant. We've used
  # "org_<id>" for the workspace-wide bucket; user-scoped integrations get
  # their own bucket so personal Gmail isn't visible to teammates.
  def composio_user_id
    if scope == "user" && owner_user_id.present?
      "user_#{owner_user_id}"
    else
      "org_#{organization_id}"
    end
  end

  private

  def owner_user_consistent_with_scope
    if scope == "user" && owner_user_id.blank?
      errors.add(:owner_user_id, "is required when scope is 'user'")
    elsif scope == "org" && owner_user_id.present?
      errors.add(:owner_user_id, "must be blank when scope is 'org'")
    end
  end
end
