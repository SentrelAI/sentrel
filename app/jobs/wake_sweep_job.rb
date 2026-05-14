class WakeSweepJob
  include Sidekiq::Job

  # Sweep every minute, look 90s ahead so we wake the machine slightly before
  # BullMQ wants to fire the scheduled job. 30s of slack is enough for the
  # Fly machine to boot, the engine to start, and BullMQ's worker to pick up
  # the past-due delayed job. Anything longer just burns awake-time.
  LOOKAHEAD = 90

  def perform
    horizon = Time.current + LOOKAHEAD.seconds

    # A scheduled_work row is "due soon and not yet fired this iteration" when:
    #   - active AND
    #   - (cron / interval mode → next_run_at <= horizon)
    #     OR (once mode → fire_at <= horizon)
    #   - AND we haven't already run past this fire time
    #
    # The COALESCE picks whichever timestamp is set per mode. last_run_at < ts
    # filters out rows we've already serviced; NULL last_run_at means brand new.
    agent_ids = ScheduledWork
      .where(active: true)
      .where(
        "(next_run_at IS NOT NULL AND next_run_at <= :h) OR (mode = 'once' AND fire_at IS NOT NULL AND fire_at <= :h)",
        h: horizon,
      )
      .where(
        "last_run_at IS NULL OR last_run_at < COALESCE(next_run_at, fire_at)",
      )
      .distinct
      .pluck(:agent_id)

    return if agent_ids.empty?

    Rails.logger.info "[WakeSweep] #{agent_ids.size} agent(s) have work due within #{LOOKAHEAD}s"

    agent_ids.each do |agent_id|
      wake_if_stopped(agent_id)
    end
  end

  private

  def wake_if_stopped(agent_id)
    agent = Agent.find_by(id: agent_id)
    return unless agent

    instance = agent.instance
    return unless instance
    return unless instance.status == "stopped"

    Rails.logger.info "[WakeSweep] agent=#{agent_id} machine=#{instance.machine_id} is stopped — sending start"
    AgentMachineOps.start(agent)
  rescue StandardError => e
    Rails.logger.warn "[WakeSweep] agent=#{agent_id} failed: #{e.class}: #{e.message}"
  end
end
