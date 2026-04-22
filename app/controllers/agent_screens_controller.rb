# Phase 3 — live screen view. Streams the agent's Camofox display back to
# the user via noVNC over the machine's public IP.
#
# Today this just renders a page with an embedded noVNC iframe pointing at
# the agent's machine on :6080 (where the display-stack container exposes
# websockify). The "Watch my agent" button in the show page links here.
#
# In development with AGENT_PROVISIONER unset, the agent has no assigned
# machine — we just show a friendly "Not available in dev" state.
class AgentScreensController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # GET /agents/:agent_id/screen
  def show
    instance = @agent.instance
    render inertia: "agents/screen", props: {
      agent: @agent.as_json(only: [:id, :name, :slug, :role]),
      instance: instance && {
        status: instance.status,
        provider: instance.provider,
        public_ip: instance.public_ip,
        machine_type: instance.machine_type,
        health_checked_at: instance.health_checked_at,
        # noVNC WebSocket URL — the display-stack sidecar exposes :6080 on
        # the machine. Over TLS this needs a reverse proxy; dev/local can
        # use http directly via browser warnings.
        vnc_url: instance.public_ip && "ws://#{instance.public_ip}:6080/websockify",
      },
    }
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end
end
