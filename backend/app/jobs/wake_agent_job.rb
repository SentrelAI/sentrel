# Start a sleeping agent's Fly machine. Idempotent — Fly treats start on a
# running machine as a no-op, and double-enqueues collapse harmlessly.
class WakeAgentJob < ApplicationJob
  queue_as :default

  def perform(agent_id)
    agent = Agent.find_by(id: agent_id)
    return unless agent&.status == "sleeping"
    result = AgentWaker.wake!(agent)
    Rails.logger.info "WakeAgentJob: agent #{agent_id} → #{result.inspect}"
  end
end
