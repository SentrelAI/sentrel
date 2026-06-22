class Api::Mobile::RegistrationsController < Api::Mobile::BaseController
  # Signup mints the first token, so it can't require one.
  skip_before_action :authenticate_mobile!, only: :create

  # POST /api/mobile/signup
  #   { name, email, password, password_confirmation, organization_name }
  # Mirrors Users::RegistrationsController#create — a new user is the owner of a
  # brand-new organization — then returns a device token like login does. The
  # fresh org has no onboarding_completed_at, so the app routes into onboarding.
  def create
    email = params[:email].to_s.strip.downcase
    org_name = params[:organization_name].to_s.strip.presence || "My Organization"

    org = Organization.new(name: org_name, slug: unique_slug(org_name))
    user = User.new(
      name: params[:name].to_s.strip,
      email: email,
      password: params[:password].to_s,
      password_confirmation: params[:password_confirmation].presence || params[:password].to_s,
      role: "owner"
    )
    user.organization = org

    begin
      ActiveRecord::Base.transaction do
        org.save!
        user.save!
      end
    rescue ActiveRecord::RecordInvalid => e
      invalid = e.record
      message = if invalid.is_a?(Organization) && invalid.errors[:slug].any?
        "Organization name is already taken"
      else
        invalid.errors.full_messages.join(", ")
      end
      return render json: { error: "signup_failed", messages: [ message ] }, status: :unprocessable_entity
    end

    SignupNotificationMailer.new_signup(user, source: "mobile").deliver_later rescue nil

    device = user.mobile_devices.create!(
      platform: params[:platform],
      device_name: params[:device_name],
      expo_push_token: params[:expo_push_token].presence,
      last_seen_at: Time.current
    )

    render json: {
      token: device.auth_token,
      device_id: device.id,
      user: user_payload(user),
      onboarding_required: org.onboarding_completed_at.nil?
    }, status: :created
  end

  private

  def unique_slug(name)
    base = name.parameterize.presence || "org"
    "#{base}-#{SecureRandom.hex(3)}"
  end

  def user_payload(user)
    {
      id: user.to_param,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: user.organization&.as_json(only: [ :id, :name, :slug ])
    }
  end
end
