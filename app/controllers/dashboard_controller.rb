class DashboardController < ApplicationController
  before_action :authenticate_user!

  def index
    render inertia: "dashboard/index", props: {
      agents: current_tenant.agents.includes(:ai_config, :instance).map { |a|
        a.as_json(only: [:id, :name, :slug, :role, :status]).merge(
          llm_model: a.ai_config&.model_id,
          instance_status: a.instance&.status
        )
      },
      stats: {
        total_agents: current_tenant.agents.count,
        running_agents: current_tenant.agents.where(status: "running").count,
        pending_approvals: current_tenant.pending_approvals.where(status: "pending").count,
        tasks_in_progress: current_tenant.tasks.where(status: "in_progress").count
      }
    }
  end
end
