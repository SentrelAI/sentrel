class Users::OmniauthCallbacksController < Devise::OmniauthCallbacksController
  def google_oauth2
    auth = request.env["omniauth.auth"]
    # Mobile flow tags the request with mobile=1 + the app's deep-link redirect
    # (see Api::Mobile::OauthController). Detect it and bounce a device token
    # back to the app instead of starting a cookie session.
    mobile = request.env.dig("omniauth.params", "mobile").to_s == "1"
    app_redirect = request.env.dig("omniauth.params", "redirect").to_s

    if auth.blank?
      return finish_mobile_oauth(app_redirect, error: "not_configured") if mobile
      redirect_to new_user_session_path, alert: "Google sign-in is not configured."
      return
    end

    user = find_or_create_user_from_google(auth)

    if mobile
      if user.persisted?
        device = user.mobile_devices.create!(platform: "ios", device_name: "Google sign-in", last_seen_at: Time.current)
        finish_mobile_oauth(app_redirect, token: device.auth_token)
      else
        finish_mobile_oauth(app_redirect, error: "signin_failed")
      end
      return
    end

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

  # Bounce back into the Expo app via its deep link, carrying either the device
  # token (success) or an error code. Custom-scheme redirect needs
  # allow_other_host. Falls back to a plain message if the redirect is missing
  # or not one of our app schemes.
  def finish_mobile_oauth(app_redirect, token: nil, error: nil)
    unless Api::Mobile::OauthController.valid_mobile_redirect?(app_redirect)
      render plain: (token ? "Signed in. Return to the app." : "Sign-in failed."), status: :ok
      return
    end
    sep = app_redirect.include?("?") ? "&" : "?"
    query = token ? "token=#{CGI.escape(token)}" : "error=#{CGI.escape(error.to_s)}"
    redirect_to "#{app_redirect}#{sep}#{query}", allow_other_host: true
  end

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
