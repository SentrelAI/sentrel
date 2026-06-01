# A user's membership in an organization. The source of truth for the
# many-to-many between users and orgs — one user (one email) can hold many
# memberships and switch between them. `users.organization_id` / `users.role`
# track which membership is *active* right now (see User#switch_to!).
#
# Deliberately NOT acts_as_tenant: a user's memberships span organizations, so
# lookups here must cross tenant boundaries (e.g. building the org switcher).
class Membership < ApplicationRecord
  ROLES = %w[owner admin member viewer].freeze

  belongs_to :user
  belongs_to :organization

  validates :role, presence: true, inclusion: { in: ROLES }
  validates :user_id, uniqueness: { scope: :organization_id, message: "is already a member of this organization" }

  # Mirrors User#admin? — owners and admins are both "admin" for in-org
  # privileged actions (invite teammates, edit org settings, etc.).
  def admin?
    role.in?(%w[owner admin])
  end
end
