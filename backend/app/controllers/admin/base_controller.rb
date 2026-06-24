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
    include Pagy::Backend

    before_action :authenticate_user!
    before_action :require_platform_admin!

    private

    def require_platform_admin!
      return if current_user&.platform_admin?
      redirect_to root_path, alert: "Platform admin access required."
    end

    # Serializes Pagy metadata into the shape the React pagination footer
    # consumes. Kept here so every admin #index returns the same envelope.
    def pagy_props(pagy)
      {
        page: pagy.page,
        pages: pagy.pages,
        count: pagy.count,
        per_page: pagy.limit,
        from: pagy.from,
        to: pagy.to
      }
    end

    # Records a row destroyed by a platform admin. AuditLog#organization_id
    # is NOT NULL, so when the destroyed record has no org (e.g. system
    # template, user with org dependent-destroyed already, agent we just
    # nuked), fall back to the acting admin's own org so the entry is still
    # written. action defaults to "admin_destroy"; bulk callers override
    # with "admin_bulk_destroy".
    def record_admin_destroy(record, action: "admin_destroy")
      tenant_id = (record.respond_to?(:organization_id) && record.organization_id) ||
                  current_user&.organization_id
      return if tenant_id.nil? # last-ditch — shouldn't happen but don't crash a destroy on logging
      ActsAsTenant.without_tenant do
        AuditLog.create!(
          organization_id: tenant_id,
          acting_user_id: current_user.id,
          action: action,
          tool_name: record.class.name.demodulize.underscore,
          input: {
            target_type: record.class.name,
            target_id: record.id,
            target_slug: record.try(:slug),
            target_name: record.try(:name) || record.try(:email)
          }.compact,
          status: "success",
        )
      end
    rescue => e
      # Never let an audit-log failure block the actual destroy.
      Rails.logger.error "[Admin#record_admin_destroy] #{e.class}: #{e.message}"
    end
  end
end
