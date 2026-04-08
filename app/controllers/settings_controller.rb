class SettingsController < ApplicationController
  before_action :authenticate_user!

  def show
    render inertia: "settings/show", props: {
      organization: current_tenant.as_json(only: [:id, :name, :slug, :email_domain, :email_domain_verified, :context_md]),
      members: current_tenant.users.order(:name).as_json(only: [:id, :name, :email, :role, :created_at])
    }
  end

  def update
    if current_tenant.update(organization_params)
      redirect_to settings_path, notice: "Settings updated"
    else
      redirect_back fallback_location: settings_path, alert: current_tenant.errors.full_messages.join(", ")
    end
  end

  private

  def organization_params
    params.require(:organization).permit(:name, :email_domain, :context_md)
  end
end
