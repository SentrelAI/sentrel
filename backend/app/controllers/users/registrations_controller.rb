class Users::RegistrationsController < Devise::RegistrationsController
  def new
    render inertia: "registrations/new"
  end

  def create
    org = Organization.new(
      name: sign_up_params[:organization_name] || "My Organization",
      slug: sign_up_params[:organization_name]&.parameterize || "org-#{SecureRandom.hex(4)}"
    )

    build_resource(sign_up_params.except(:organization_name).merge(role: "owner"))
    resource.organization = org

    ActiveRecord::Base.transaction do
      org.save!
      resource.save!
    end

    SignupNotificationMailer.new_signup(resource, source: "email").deliver_later

    set_flash_message!(:notice, :signed_up)
    sign_up(resource_name, resource)
    redirect_to after_sign_up_path_for(resource)
  rescue ActiveRecord::RecordInvalid => e
    invalid = e.record
    message = if invalid.is_a?(Organization) && invalid.errors[:slug].any?
      "Organization name is already taken"
    else
      invalid.errors.full_messages.join(", ")
    end
    redirect_to new_user_registration_path, alert: message
  end

  private

  def sign_up_params
    params.require(:user).permit(:name, :email, :password, :password_confirmation, :organization_name)
  end

  # A fresh signup from a shared /deploy-agent link returns to that link
  # (the deploy wizard is whitelisted from the onboarding gate, so they
  # can deploy immediately) instead of the default post-signup landing.
  def after_sign_up_path_for(resource)
    stored_location_for(resource) || super
  end
end
