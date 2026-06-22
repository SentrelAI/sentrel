# A single logged-in Expo (React Native) device. Doubles as the API session
# (auth_token is the bearer credential) and the push target (expo_push_token).
# Deliberately NOT tenant-scoped: a user can belong to many orgs and switch
# between them on one device; the active org is resolved from user.organization
# per request, same as the web app.
class MobileDevice < ApplicationRecord
  belongs_to :user

  before_validation :ensure_auth_token, on: :create

  validates :auth_token, presence: true, uniqueness: true

  scope :pushable, -> { where.not(expo_push_token: [ nil, "" ]) }

  def touch_seen!
    update_column(:last_seen_at, Time.current)
  end

  private

  def ensure_auth_token
    self.auth_token ||= SecureRandom.urlsafe_base64(32)
  end
end
