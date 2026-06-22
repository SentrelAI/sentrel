class Api::Mobile::SessionsController < Api::Mobile::BaseController
  # Login is the one endpoint that mints a token, so it can't require one.
  skip_before_action :authenticate_mobile!, only: :create

  # POST /api/mobile/login  { email, password, device_name, platform, expo_push_token }
  # Validates the password via Devise's bcrypt digest (no cookie session is
  # created — mobile is stateless/token-based) and returns a fresh device token.
  def create
    email = params[:email].to_s.strip.downcase
    user = User.find_by("LOWER(email) = ?", email)

    unless user&.valid_password?(params[:password].to_s)
      return render json: { error: "invalid_credentials" }, status: :unauthorized
    end

    device = user.mobile_devices.create!(
      platform: params[:platform],
      device_name: params[:device_name],
      expo_push_token: params[:expo_push_token].presence,
      last_seen_at: Time.current
    )

    render json: {
      token: device.auth_token,
      device_id: device.id,
      user: user_payload(user)
    }, status: :created
  end

  # GET /api/mobile/me — used by the app on launch to validate a stored token.
  def show
    render json: { user: user_payload(current_user), device_id: @mobile_device.id }
  end

  # DELETE /api/mobile/logout — revoke just this device.
  def destroy
    @mobile_device.destroy
    head :no_content
  end

  private

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
