class Users::FailureApp < Devise::FailureApp
  def respond
    if request.format == :html
      redirect
    else
      super
    end
  end

  def redirect
    store_location!
    flash[:alert] = i18n_message
    redirect_to new_user_session_path
  end
end
