# Scale-to-zero, wake half. Engines self-stop after sitting idle (status
# "sleeping", Fly machine stopped, cost ≈ volume only); this brings them
# back the moment work exists. Work is never lost in the gap — every
# delivery path queues into Redis (AgentEventBus inbox list / BullMQ),
# and a booting engine drains its queues first thing.
#
# Only "sleeping" agents auto-wake. A user-stopped agent ("stopped")
# stays stopped — that's an explicit decision, not an idle state.
module AgentWaker
  module_function

  # Fire-and-forget: enqueue the machine start and return. Callers sit on
  # hot paths (message delivery), so no Fly API round-trip here.
  def wake_async(agent)
    return unless agent&.status == "sleeping"
    return if agent.instance&.machine_id.blank?
    WakeAgentJob.perform_later(agent.id)
  rescue => e
    Rails.logger.error "AgentWaker.wake_async failed for agent #{agent&.id}: #{e.message}"
  end

  def wake!(agent)
    AgentMachineOps.start(agent)
  end
end
