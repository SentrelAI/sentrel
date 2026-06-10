class Users::OmniauthCallbacksController < Devise::OmniauthCallbacksController
  def google_oauth2
    auth = request.env["omniauth.auth"]
    if auth.blank?
      redirect_to new_user_session_path, alert: "Google sign-in is not configured."
      return
    end

    user = find_or_create_user_from_google(auth)

    if user.persisted?
      sign_in_and_redirect user, event: :authentication
      set_flash_message(:notice, :success, kind: "Google") if is_navigational_format?
    else
      session["devise.google_data"] = auth.except(:extra)
      redirect_to new_user_registration_path,
                  alert: user.errors.full_messages.to_sentence.presence || "Could not sign in with Google."
    end
  end

  def failure
    redirect_to new_user_session_path, alert: "Google sign-in was cancelled or failed."
  end

  private

  # Resolution order:
  # 1. UserIdentity row for channel=google + Google `sub` → existing OAuth user.
  # 2. User with matching email → link Google identity to that account.
  # 3. New user + new single-user organization.
  def find_or_create_user_from_google(auth)
    uid = auth.uid.to_s
    email = auth.info.email.to_s.downcase
    name = auth.info.name.presence || email.split("@").first

    identity = ActsAsTenant.without_tenant do
      UserIdentity.find_by(channel: "google", external_id: uid)
    end
    return identity.user if identity

    existing_user = User.find_by(email: email)
    if existing_user
      ActsAsTenant.with_tenant(existing_user.organization) do
        UserIdentity.claim!(user: existing_user, channel: "google", external_id: uid, display_name: name)
      end
      return existing_user
    end

    create_user_with_organization!(uid: uid, email: email, name: name)
  end

  def create_user_with_organization!(uid:, email:, name:)
    org_name = name.presence || "My Organization"
    base_slug = org_name.parameterize.presence || "org"
    slug = "#{base_slug}-#{SecureRandom.hex(3)}"
    password = SecureRandom.hex(24)

    user = User.new(
      name: name,
      email: email,
      password: password,
      password_confirmation: password,
      role: "owner",
    )

    ActiveRecord::Base.transaction do
      org = Organization.create!(name: org_name, slug: slug)
      user.organization = org
      user.save!
      ActsAsTenant.with_tenant(org) do
        UserIdentity.create!(
          organization_id: org.id,
          user: user,
          channel: "google",
          external_id: uid,
          display_name: name,
        )
      end
    end

    SignupNotificationMailer.new_signup(user, source: "google_oauth").deliver_later

    user
  rescue ActiveRecord::RecordInvalid => e
    User.new(email: email).tap do |u|
      u.errors.add(:base, e.record.errors.full_messages.to_sentence)
    end
  end
end
