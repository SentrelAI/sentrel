class Api::Mobile::DevicesController < Api::Mobile::BaseController
  # PATCH /api/mobile/device — register/refresh the Expo push token for the
  # current device once the OS grants notification permission. Also de-dupes:
  # if another of this user's devices already claimed this exact push token
  # (reinstall / token reissue), clear it there so we don't double-deliver.
  def update
    token = params[:expo_push_token].presence
    if token
      current_user.mobile_devices
                  .where.not(id: @mobile_device.id)
                  .where(expo_push_token: token)
                  .update_all(expo_push_token: nil)
    end

    @mobile_device.update!(
      expo_push_token: token,
      platform: params[:platform].presence || @mobile_device.platform,
      device_name: params[:device_name].presence || @mobile_device.device_name
    )
    render json: { ok: true }
  end

  # POST /api/mobile/device/test_push — sends a sample notification to this
  # device. Lets a user verify the end-to-end push path from inside the app
  # without waiting on a real agent reply or a spend-cap breach.
  def test_push
    unless @mobile_device.expo_push_token.present?
      return render json: { ok: false, error: "no_push_token" }, status: :unprocessable_entity
    end
    MobilePushJob.perform_later(
      user_ids: [ current_user.id ],
      title: "Sentrel",
      body: "Push notifications are working 🎉",
      data: { type: "test" }
    )
    render json: { ok: true }
  end
end
