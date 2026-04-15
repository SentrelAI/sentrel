class ApplicationController < ActionController::Base
  include Pundit::Authorization

  allow_browser versions: :modern

  set_current_tenant_through_filter
  before_action :set_tenant

  before_action :configure_permitted_parameters, if: :devise_controller?

  # Share current user and org with all Inertia pages
  inertia_share do
    {
      auth: {
        user: current_user&.as_json(only: [:id, :name, :email, :role]),
        organization: current_tenant&.as_json(only: [:id, :name, :slug])
      },
      flash: {
        success: flash[:notice],
        error: flash[:alert]
      }
    }
  end

  private

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

  def configure_permitted_parameters
    devise_parameter_sanitizer.permit(:sign_up, keys: [:name])
    devise_parameter_sanitizer.permit(:account_update, keys: [:name])
  end
end
