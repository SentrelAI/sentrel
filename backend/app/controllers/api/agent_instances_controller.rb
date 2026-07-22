# Engine → Rails callback. Called at engine boot and then periodically by the
# engine health reporter.
#
# Rails uses this to flip the instance to "running", refresh
# health_checked_at, and clear stale heartbeat errors so the admin UI can show
# a real liveness signal.
class Api::AgentInstancesController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!

  # POST /api/agent_instances/asleep
  # Body: { employee_id: N }
  # Scale-to-zero: the engine calls this right before exiting on idle. The
  # agent reads "sleeping" (auto-wakes on new work via AgentWaker + the
  # WakeSweep schedule sweep); the instance reads "stopped" so the sweep's
  # existing gate matches. A user-initiated stop never comes through here.
  def asleep
    agent = Agent.find_by(id: params[:employee_id])
    return head :not_found unless agent
    agent.update_column(:status, "sleeping")
    agent.instance&.update_columns(status: "stopped", stopped_at: Time.current, updated_at: Time.current)
    head :ok
  end

  # POST /api/agent_instances/ready
  # Body: { employee_id: N, public_ip: "1.2.3.4" }
  def ready
    agent = Agent.find_by(id: params[:employee_id])
    return head :not_found unless agent

    # Auto-create an Instance on first-report so local dev + re-provisioned
    # agents don't need a pre-existing row. Production FlyBackend normally
    # creates the row before the engine boots, but tolerate either order.
    instance = agent.instance || agent.build_instance(
      provider: Rails.env.development? ? "local" : "fly",
      machine_id: "unknown",
    )

    attrs = {
      status: "running",
      public_ip: params[:public_ip].presence || instance.public_ip,
      health_checked_at: Time.current,
      started_at: instance.started_at || Time.current
    }
    if instance.provisioning_error.to_s.start_with?("Engine heartbeat", "No engine heartbeat")
      attrs[:provisioning_error] = nil
    end
    instance.update!(attrs)
    Rails.logger.info "Agent #{agent.id} instance ready: #{instance.public_ip}"
    head :ok
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
