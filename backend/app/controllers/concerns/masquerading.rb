module Masquerading
  extend ActiveSupport::Concern

  # Start a Devise session as `target` while remembering `admin` in
  # `session[:impersonator_id]`. Caller is responsible for any authorization
  # check; this method only enforces invariants we never want to bypass
  # (no self-masquerade, no nested masquerade, no impersonating another
  # platform admin).
  def start_masquerade!(admin:, target:)
    raise ArgumentError, "admin and target required" unless admin && target
    raise Masquerading::Error, "Cannot masquerade as yourself" if admin.id == target.id
    raise Masquerading::Error, "Already masquerading — stop first" if impersonating?
    raise Masquerading::Error, "Cannot masquerade as another platform admin" if target.platform_admin?

    record_masquerade_event!(admin: admin, target: target, action: "masquerade_start")

    sign_in(:user, target)
    # set AFTER sign_in: Warden may reset the session on user swap, which
    # would otherwise drop the impersonator_id we just stored.
    session[:impersonator_id] = admin.id
  end

  # Restore the impersonator's session. Returns the admin we re-signed-in as,
  # or nil if there was nothing to stop.
  def stop_masquerade!
    admin_id = session[:impersonator_id]
    return nil unless admin_id

    admin = User.find_by(id: admin_id)
    target = current_user

    # Clear the marker before re-signing-in so a Warden session reset on
    # sign_in can't leave a stale impersonator_id behind.
    session.delete(:impersonator_id)

    if admin
      sign_in(:user, admin)
      record_masquerade_event!(admin: admin, target: target, action: "masquerade_stop") if target
      admin
    else
      # Impersonator row was deleted while we were masquerading. Drop the
      # session entirely rather than silently leaving the target signed in.
      sign_out(:user)
      nil
    end
  end

  def impersonating?
    session[:impersonator_id].present?
  end

  # The platform admin who initiated the masquerade. nil unless impersonating.
  def true_user
    return nil unless impersonating?
    @true_user ||= User.find_by(id: session[:impersonator_id])
  end

  class Error < StandardError; end

  private

  def record_masquerade_event!(admin:, target:, action:)
    tenant_id = target.organization_id || admin.organization_id
    return unless tenant_id

    ActsAsTenant.without_tenant do
      AuditLog.create!(
        organization_id: tenant_id,
        acting_user_id: admin.id,
        action: action,
        tool_name: "masquerade",
        input: {
          target_user_id: target.id,
          target_user_email: target.email,
          admin_user_id: admin.id,
          admin_user_email: admin.email,
          remote_ip: request&.remote_ip,
        }.compact,
        status: "success",
      )
    end
  rescue => e
    # Never let an audit-log failure break the session swap — but log loudly.
    Rails.logger.error "[Masquerading#record_masquerade_event!] #{e.class}: #{e.message}"
    Sentry.capture_exception(e) if defined?(Sentry) && Sentry.initialized?
  end
end
