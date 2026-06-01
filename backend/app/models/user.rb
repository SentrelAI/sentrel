class User < ApplicationRecord
  has_prefix_id :usr
  include PublicIdSerialization

  devise :database_authenticatable, :registerable,
         :recoverable, :rememberable, :validatable,
         :omniauthable, omniauth_providers: [ :google_oauth2 ]

  # The user's *active* organization — the tenant every request resolves to.
  # One of (potentially many) orgs they're a member of; see #switch_to!.
  belongs_to :organization
  has_many :user_identities, dependent: :destroy
  has_many :memberships, dependent: :destroy
  has_many :organizations, through: :memberships

  validates :name, presence: true
  validates :role, presence: true, inclusion: { in: %w[owner admin member viewer] }

  # Keep a membership row in step with the active-org pointer. On create we
  # seed the membership for the org the user was registered into; on role
  # changes (e.g. the admin panel) we mirror the new role onto the membership
  # for the active org so the switcher + require_admin checks stay correct.
  after_create :ensure_active_membership
  after_update :sync_active_membership_role, if: -> { saved_change_to_role? || saved_change_to_organization_id? }

  # Org-level role: this user's relationship to THEIR OWN organization.
  # `admin?` returns true for owner + admin within the org. Used by
  # in-org features (invite users, change billing, etc.).
  def admin?
    role.in?(%w[admin owner])
  end

  def owner?
    role == "owner"
  end

  # Has this user accepted/created at least one other org they could switch to?
  def member_of_multiple_organizations?
    memberships.count > 1
  end

  def member_of?(org)
    org && memberships.exists?(organization_id: org.id)
  end

  # Make `org` this user's active organization. Drives acts_as_tenant for every
  # subsequent request (set_tenant reads current_user.organization). Refuses
  # orgs the user isn't a member of — find_by! is the authorization check.
  # `users.role` is realigned to the role recorded on that membership.
  def switch_to!(org)
    membership = memberships.find_by!(organization_id: org.id)
    update!(organization_id: org.id, role: membership.role)
    org
  end

  # PLATFORM admin: cross-tenant access to /admin (see every org's
  # templates/skills/agents/users, run Forge, manage everything).
  # Backed by the `platform_admin` boolean column on users — set via
  # the /admin/users panel by another platform admin. Deliberately
  # separate from `admin?` so org admins can't read other orgs' data.
  # ScribeMD operators only.
  def platform_admin?
    platform_admin == true
  end

  private

  def ensure_active_membership
    return unless organization_id
    Membership.find_or_create_by!(user_id: id, organization_id: organization_id) do |m|
      m.role = role
    end
  end

  def sync_active_membership_role
    return unless organization_id
    membership = memberships.find_by(organization_id: organization_id)
    membership&.update!(role: role) unless membership&.role == role
  end
end
