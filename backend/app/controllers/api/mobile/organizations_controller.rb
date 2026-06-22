class Api::Mobile::OrganizationsController < Api::Mobile::BaseController
  # GET /api/mobile/organizations — every org the user belongs to + their role,
  # with is_current flagging the active one (drives the switcher).
  def index
    render json: { organizations: org_list }
  end

  # POST /api/mobile/organizations/:id/switch — change the active org.
  # Membership is the authz check: find on the through-association 404s for any
  # org the user isn't a member of.
  def switch
    org = current_user.organizations.find(params[:id])
    current_user.switch_to!(org)
    set_current_tenant(current_user.organization)
    render json: {
      user: user_payload(current_user.reload),
      onboarding_required: org.onboarding_completed_at.nil?,
      organizations: org_list
    }
  end

  # POST /api/mobile/organizations  { name }
  # Create a new org, make the user its owner, switch into it. The fresh org has
  # no onboarding_completed_at, so the app routes into the onboarding flow.
  def create
    name = params[:name].to_s.strip.presence || "My Organization"
    org = ActiveRecord::Base.transaction do
      new_org = Organization.create!(name: name, slug: unique_slug(name))
      current_user.memberships.create!(organization: new_org, role: "owner")
      current_user.switch_to!(new_org)
      new_org
    end
    set_current_tenant(current_user.organization)

    render json: {
      user: user_payload(current_user.reload),
      organization: org.as_json(only: [ :id, :name, :slug ]),
      onboarding_required: true,
      organizations: org_list
    }, status: :created
  end

  private

  def org_list
    active_id = current_user.organization_id
    current_user.memberships.includes(:organization).map do |m|
      {
        id: m.organization_id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        is_current: m.organization_id == active_id,
        onboarding_completed: m.organization.onboarding_completed_at.present?
      }
    end.sort_by { |o| o[:name].to_s.downcase }
  end

  def unique_slug(name)
    base = name.parameterize.presence || "org"
    "#{base}-#{SecureRandom.hex(3)}"
  end

  def user_payload(user)
    {
      id: user.to_param,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: user.organization&.as_json(only: [ :id, :name, :slug ])
    }
  end
end
