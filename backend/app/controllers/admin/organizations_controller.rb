module Admin
  class OrganizationsController < BaseController
    def index
      rows = Organization.order(created_at: :desc).map { |o| serialize(o) }
      render inertia: "admin/organizations/index", props: { organizations: rows }
    end

    def update
      org = Organization.find(params[:id])
      attrs = params.permit(:name, :slug, :company_summary)
      org.update!(attrs)
      redirect_to admin_organizations_path, notice: "Updated #{org.name}"
    end

    def destroy
      org = Organization.find(params[:id])
      org.destroy!
      redirect_to admin_organizations_path, notice: "Deleted org #{org.slug}"
    end

    private

    def serialize(o)
      counts = ActsAsTenant.with_tenant(o) do
        {
          users: o.users.count,
          agents: o.agents.count,
        }
      end
      {
        id: o.id, name: o.name, slug: o.slug,
        company_summary: o.try(:company_summary),
        onboarding_completed_at: o.try(:onboarding_completed_at),
        created_at: o.created_at,
        users_count: counts[:users],
        agents_count: counts[:agents],
      }
    end
  end
end
