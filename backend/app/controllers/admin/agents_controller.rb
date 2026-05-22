module Admin
  # Cross-org view of every agent. The owning organization gets surfaced
  # so admins can spot which org owns what without switching tenants.
  class AgentsController < BaseController
    include Admin::Concerns::BulkDestroyable
    bulk_destroyable Agent, tenant_bypass: true

    def index
      q = params[:q].to_s.strip

      pagy, rows = ActsAsTenant.without_tenant do
        scope = Agent.includes(:organization, :ai_config).order(updated_at: :desc)
        if q.present?
          like = "%#{q.downcase}%"
          scope = scope.where("LOWER(agents.name) LIKE ? OR LOWER(agents.slug) LIKE ? OR LOWER(agents.role) LIKE ?", like, like, like)
        end
        pagy(scope, limit: params[:per_page])
      end

      render inertia: "admin/agents/index", props: {
        agents: rows.map { |a| serialize(a) },
        pagy: pagy_props(pagy),
        q: q,
      }
    end

    def update
      ActsAsTenant.without_tenant do
        agent = Agent.find(params[:id])
        attrs = params.permit(:name, :status, :role)
        agent.update!(attrs)
        redirect_to admin_agents_path, notice: "Updated #{agent.name}"
      end
    end

    def destroy
      ActsAsTenant.without_tenant do
        agent = Agent.find(params[:id])
        agent.destroy!
        redirect_to admin_agents_path, notice: "Deleted agent #{agent.name}"
      end
    end

    private

    def serialize(a)
      {
        id: a.id, name: a.name, slug: a.slug, role: a.role, status: a.status,
        organization: a.organization&.as_json(only: [:id, :name, :slug]),
        ai_config: a.ai_config&.as_json(only: [:provider, :model_id]),
        created_at: a.created_at, updated_at: a.updated_at,
        # Quick-glance: how many channels + skills are wired
        channels: a.respond_to?(:channel_configs) ? a.channel_configs.count : 0,
        skills: a.respond_to?(:skill_definitions) ? a.skill_definitions.count : 0,
      }
    end
  end
end
