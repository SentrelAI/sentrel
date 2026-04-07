class Users::SessionsController < Devise::SessionsController
  def new
    render inertia: "sessions/new"
  end

  def create
    # Inertia sends params under :session, Devise expects :user
    if params[:session] && !params[:user]
      params[:user] = params[:session]
    end

    self.resource = warden.authenticate!(auth_options)
    set_flash_message!(:notice, :signed_in)
    sign_in(resource_name, resource)
    redirect_to after_sign_in_path_for(resource)
  end

  def destroy
    signed_out = (Devise.sign_out_all_scopes ? sign_out : sign_out(resource_name))
    redirect_to new_user_session_path
  end
end
