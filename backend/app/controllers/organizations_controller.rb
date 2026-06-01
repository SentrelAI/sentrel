# User-facing organization management — distinct from Admin::OrganizationsController
# (the cross-tenant platform panel). Lets any signed-in user spin up a brand new
# organization (becoming its owner) and switch between the orgs they belong to,
# all on a single account / email.
class OrganizationsController < ApplicationController
  before_action :authenticate_user!

  # POST /organizations
  # Create a new org, make the current user its owner, and switch into it. The
  # fresh org has no onboarding_completed_at, so ApplicationController's
  # redirect_to_onboarding funnels the user straight into onboarding for it.
  def create
    name = params[:name].to_s.strip.presence || "My Organization"

    org = ActiveRecord::Base.transaction do
      new_org = Organization.create!(name: name, slug: unique_slug(name))
      current_user.memberships.create!(organization: new_org, role: "owner")
      current_user.switch_to!(new_org)
      new_org
    end

    redirect_to onboarding_path, notice: "Let's set up #{org.name}."
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: dashboard_path,
                  alert: e.record.errors.full_messages.to_sentence.presence || "Could not create organization."
  end

  # POST /organizations/:id/switch
  # Switch the active org. Membership is the authorization check — find on the
  # through-association 404s for any org the user doesn't belong to.
  def switch
    org = current_user.organizations.find(params[:id])
    current_user.switch_to!(org)
    redirect_to dashboard_path, notice: "Switched to #{org.name}"
  rescue ActiveRecord::RecordNotFound
    redirect_to dashboard_path, alert: "You don't have access to that organization."
  end

  private

  # Slug is globally unique; a short random suffix keeps "Acme" creatable
  # any number of times without collisions (mirrors the registration flow).
  def unique_slug(name)
    base = name.parameterize.presence || "org"
    "#{base}-#{SecureRandom.hex(3)}"
  end
end
