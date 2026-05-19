class ApplicationController < ActionController::Base
  include Pundit::Authorization

  allow_browser versions: :modern

  set_current_tenant_through_filter
  before_action :redirect_apex_to_www
  before_action :set_tenant

  before_action :configure_permitted_parameters, if: :devise_controller?
  before_action :consume_pending_invitation, if: :user_signed_in?
  before_action :redirect_to_onboarding, if: :user_signed_in?

  # Share current user and org with all Inertia pages
  inertia_share do
    {
      auth: {
        user: current_user&.as_json(only: [ :id, :name, :email, :role ]),
        organization: current_tenant&.as_json(only: [ :id, :name, :slug, :onboarding_completed_at ])
      },
      flash: {
        success: flash[:notice],
        error: flash[:alert]
      }
    }
  end

  private

  def redirect_apex_to_www
    return unless Rails.env.production? && request.host == "double.md"
    redirect_to "https://www.double.md#{request.fullpath}",
                status: :moved_permanently,
                allow_other_host: true
  end

  # Lookup a record by either its public prefix_id (agt_..., tsk_..., etc.)
  # or a raw numeric id. Relation-scoped — pass a chain like
  # `current_tenant.agents` to keep tenant isolation.
  #
  # The gem's `find()` override doesn't fire through tenant-scoped relations
  # (acts_as_tenant + prefixed_ids interaction), so we decode explicitly.
  def find_by_public_id!(scope, param)
    prefix_id = scope.klass.respond_to?(:_prefix_id) ? scope.klass._prefix_id : nil
    numeric   = prefix_id ? (prefix_id.decode(param, fallback: true) || param) : param
    scope.find(numeric)
  end

  def set_tenant
    if current_user
      set_current_tenant(current_user.organization)
      set_sentry_context
    end
  end

  def set_sentry_context
    return unless defined?(Sentry) && Sentry.initialized?

    Sentry.set_user(id: current_user.id, email: current_user.email)
    Sentry.set_tags(org_id: current_tenant&.id, org_slug: current_tenant&.slug)
  end

  # After sign-in/up, auto-accept any invitation the user was mid-flow for
  # (captured in session by InvitationsController#accept when unauthenticated).
  def consume_pending_invitation
    token = session.delete(:pending_invitation_token) || params[:invitation].presence
    return unless token.present?
    inv = Invitation.find_by(token: token)
    return unless inv&.pending?
    return unless inv.email.casecmp?(current_user.email) # must match the invited email
    inv.accept!(current_user)
    flash[:notice] = "Joined #{inv.organization.name}"
  rescue => e
    Rails.logger.warn "Invitation consume failed: #{e.message}"
  end

  def redirect_to_onboarding
    return if devise_controller?
    return if self.is_a?(OnboardingController)
    return if request.path.start_with?("/onboarding", "/api", "/webhooks")
    return if current_tenant&.onboarding_completed_at.present?

    redirect_to onboarding_path
  end

  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [ :name ])
    devise_parameter_sanitizer.permit(:account_update, keys: [ :name ])
  end
end
