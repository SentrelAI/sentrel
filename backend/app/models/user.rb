class User < ApplicationRecord
  has_prefix_id :usr
  include PublicIdSerialization

  devise :database_authenticatable, :registerable,
         :recoverable, :rememberable, :validatable

  belongs_to :organization
  has_many :user_identities, dependent: :destroy

  validates :name, presence: true
  validates :role, presence: true, inclusion: { in: %w[owner admin member viewer] }

  # Org-level role: this user's relationship to THEIR OWN organization.
  # `admin?` returns true for owner + admin within the org. Used by
  # in-org features (invite users, change billing, etc.).
  def admin?
    role.in?(%w[admin owner])
  end

  def owner?
    role == "owner"
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
end
