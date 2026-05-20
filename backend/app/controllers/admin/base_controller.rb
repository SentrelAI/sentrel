module Admin
  # Base controller for everything under /admin/*. Two gates:
  #   1. authenticate_user! (Devise) — must be logged in.
  #   2. require_platform_admin! — email must be in PLATFORM_ADMIN_EMAILS.
  #
  # IMPORTANT: this is PLATFORM admin (ScribeMD operators), not org admin.
  # `current_user.admin?` (the org-role check) is intentionally NOT used —
  # any org owner has role=owner and admin?=true, but they must not see
  # other orgs' data via /admin. Separation is enforced by gating on
  # User#platform_admin? which checks the PLATFORM_ADMIN_EMAILS env var.
  class BaseController < ApplicationController
    before_action :authenticate_user!
    before_action :require_platform_admin!

    private

    def require_platform_admin!
      return if current_user&.platform_admin?
      redirect_to root_path, alert: "Platform admin access required."
    end
  end
end
