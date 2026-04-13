class Api::SendEmailsController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!

  # POST /api/send_email
  # Called by the engine when an email is approved (channel YES/NO) or
  # auto-permitted. Replaces the old outbound-email Redis queue + poller
  # pattern — this is instant, no 10-second polling delay.
  def create
    payload = params.permit!.to_h.except("controller", "action")
    SendEmailJob.perform_later(payload)
    render json: { status: "queued" }, status: :accepted
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
