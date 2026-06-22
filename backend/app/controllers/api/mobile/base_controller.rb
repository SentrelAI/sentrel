# Base for the Expo mobile API. Token-authenticated (Authorization: Bearer
# <MobileDevice#auth_token>) instead of the cookie session the web/Inertia
# app uses. Inherits from ApplicationController only to reuse find_by_public_id!
# and acts_as_tenant's set_current_tenant; all the cookie/Inertia/onboarding
# before_actions are gated on Devise's user_signed_in? (always false here) or
# explicitly skipped below.
class Api::Mobile::BaseController < ApplicationController
  skip_forgery_protection
  skip_before_action :set_tenant, raise: false
  skip_before_action :redirect_apex_to_www, raise: false

  before_action :authenticate_mobile!

  rescue_from ActiveRecord::RecordNotFound,   with: :render_not_found
  rescue_from ActiveRecord::RecordInvalid,    with: :render_unprocessable
  rescue_from ActionController::ParameterMissing, with: :render_bad_request

  private

  def authenticate_mobile!
    @mobile_device = bearer_token.present? && MobileDevice.find_by(auth_token: bearer_token)
    return render_unauthorized unless @mobile_device

    @current_mobile_user = @mobile_device.user
    # Resolve the tenant exactly like the web app: the user's active org.
    set_current_tenant(@current_mobile_user.organization)
    @mobile_device.touch_seen!
  end

  # Override Devise's helper so current_user resolves to the token user
  # everywhere downstream (e.g. tenant-scoped queries, Pundit if ever used).
  def current_user
    @current_mobile_user
  end

  def bearer_token
    request.headers["Authorization"].to_s[/\ABearer\s+(.+)\z/i, 1]
  end

  # Tenant-scoped agent lookup by public (agt_…) or numeric id.
  def find_agent!
    find_by_public_id!(current_tenant.agents, params[:agent_id] || params[:id])
  end

  def render_unauthorized
    render json: { error: "unauthorized" }, status: :unauthorized
  end

  def render_not_found(_e = nil)
    render json: { error: "not_found" }, status: :not_found
  end

  def render_unprocessable(e)
    messages = e.respond_to?(:record) && e.record ? e.record.errors.full_messages : [ e.message ]
    render json: { error: "unprocessable", messages: messages }, status: :unprocessable_entity
  end

  def render_bad_request(e)
    render json: { error: "bad_request", message: e.message }, status: :bad_request
  end
end
