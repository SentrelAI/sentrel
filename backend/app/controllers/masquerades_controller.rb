class MasqueradesController < ApplicationController
  # NOT gated on platform_admin: while impersonating, current_user IS the
  # target (whose permissions may be lower). The gate is the presence of
  # session[:impersonator_id], which can only have been set by
  # Admin::UsersController#masquerade — already platform-admin gated.
  before_action :authenticate_user!

  def destroy
    admin = stop_masquerade!
    if admin
      redirect_to admin_users_path, notice: "Stopped masquerading"
    else
      redirect_to root_path, alert: "Not masquerading"
    end
  end
end
