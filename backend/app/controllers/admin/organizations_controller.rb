module Admin
  class OrganizationsController < BaseController
    include Admin::Concerns::BulkDestroyable
    bulk_destroyable Organization

    def index
      q = params[:q].to_s.strip

      scope = Organization.order(created_at: :desc)
      if q.present?
        like = "%#{q.downcase}%"
        scope = scope.where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ?", like, like)
      end

      pagy, rows = pagy(scope, limit: params[:per_page])

      render inertia: "admin/organizations/index", props: {
        organizations: rows.map { |o| serialize(o) },
        pagy: pagy_props(pagy),
        q: q
      }
    end

    def update
      org = Organization.find(params[:id])
      attrs = params.permit(:name, :slug, :company_summary)
      org.update!(attrs)
      redirect_to admin_organizations_path, notice: "Updated #{org.name}"
    end

    def destroy
      org = Organization.find(params[:id])
      record_admin_destroy(org)
      org.destroy!
      redirect_to admin_organizations_path, notice: "Deleted org #{org.slug}"
    end

    private

    def bulk_destroy_filter_scope(model)
      scope = model.all
      q = params[:q].to_s.strip
      if q.present?
        like = "%#{q.downcase}%"
        scope = scope.where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ?", like, like)
      end
      scope
    end

    def serialize(o)
      counts = ActsAsTenant.with_tenant(o) do
        {
          # Member count (membership-based) — counts everyone who belongs to
          # the org, including members currently switched into another org.
          users: o.memberships.count,
          agents: o.agents.count
        }
      end
      {
        id: o.id, name: o.name, slug: o.slug,
        company_summary: o.try(:company_summary),
        onboarding_completed_at: o.try(:onboarding_completed_at),
        created_at: o.created_at,
        users_count: counts[:users],
        agents_count: counts[:agents]
      }
    end
  end
end
