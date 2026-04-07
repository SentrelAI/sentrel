class Users::RegistrationsController < Devise::RegistrationsController
  def new
    render inertia: "registrations/new"
  end

  def create
    # Create org first, then user
    org = Organization.create!(
      name: sign_up_params[:organization_name] || "My Organization",
      slug: sign_up_params[:organization_name]&.parameterize || "org-#{SecureRandom.hex(4)}"
    )

    build_resource(sign_up_params.except(:organization_name).merge(organization_id: org.id, role: "owner"))

    resource.save
    if resource.persisted?
      set_flash_message!(:notice, :signed_up)
      sign_up(resource_name, resource)
      redirect_to after_sign_up_path_for(resource)
    else
      org.destroy
      redirect_to new_user_registration_path, alert: resource.errors.full_messages.join(", ")
    end
  end

  private

  def sign_up_params
    params.require(:user).permit(:name, :email, :password, :password_confirmation, :organization_name)
  end
end
