class Users::SessionsController < Devise::SessionsController
  def new
    render inertia: "sessions/new"
  end

  def create
    self.resource = warden.authenticate(auth_options)

    if resource
      set_flash_message!(:notice, :signed_in)
      sign_in(resource_name, resource)
      redirect_to after_sign_in_path_for(resource)
    else
      redirect_to new_user_session_path, alert: "Invalid email or password"
    end
  end

  def destroy
    signed_out = (Devise.sign_out_all_scopes ? sign_out : sign_out(resource_name))
    redirect_to new_user_session_path
  end
end
