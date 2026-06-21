# Runaway-schedule circuit breaker.
#
# Background: each `scheduled_work` row fires as a full agent run (LLM tokens =
# real money). A bug in the engine's work-scheduler once let past-due `once`
# rows re-fire on every poll / engine restart, turning ~14 reminders into 478
# paid runs in a single day (~$66). The engine-side fix exists, but engines
# deploy per-agent and lag — so this is the Rails-side backstop that is
# *independent of the engine version*: it watches the audit trail and kills
# any schedule whose fire count is impossible for a healthy row.
#
# Defense in depth alongside the per-run spend cap (Api::SpendCapsController):
# the cap bounds *cost per day*, this bounds *fires per schedule*, so a loop is
# stopped at the source instead of merely capped after burning the daily budget.
#
# Runs every minute (see config/initializers/sidekiq.rb).
class ScheduledWorkCircuitBreakerJob
  include Sidekiq::Job
  sidekiq_options retry: 1

  # A `once` schedule must fire exactly once in its lifetime. We allow a little
  # slack for a legitimate retry/backfill, then treat repeated fires as a loop.
  ONCE_WINDOW = 24.hours
  ONCE_MAX_FIRES = 2

  # Coarse ceiling for ANY mode. No legitimate cron/interval needs to fire more
  # than this in an hour (> once / 3 min). Catches loops the per-mode math
  # would miss (e.g. an interval row stuck re-registering).
  CEILING_WINDOW = 60.minutes
  HARD_CEILING = 20

  # Per-agent alert (no auto-kill): if an agent's *total* scheduled fires in the
  # window crosses this, a human should look even when no single schedule is
  # individually over its limit (the original incident ran 36-48 fires/hour
  # spread across many rows).
  AGENT_ALERT_WINDOW = 60.minutes
  AGENT_ALERT_FIRES = 30

  def perform
    ActsAsTenant.without_tenant do
      trip_once_loops
      trip_hard_ceiling
      alert_noisy_agents
    end
  end

  private

  # Pass A — the actual historical bug: active `once` rows firing repeatedly.
  def trip_once_loops
    fires_by_schedule(ONCE_WINDOW).each do |sw_id, fires|
      next if fires <= ONCE_MAX_FIRES

      work = active_once_work(sw_id)
      next unless work

      trip!(work, fires, ONCE_MAX_FIRES, ONCE_WINDOW)
    end
  end

  # Pass B — mode-agnostic ceiling for genuinely runaway fire rates.
  def trip_hard_ceiling
    fires_by_schedule(CEILING_WINDOW).each do |sw_id, fires|
      next if fires <= HARD_CEILING

      work = ScheduledWork.find_by(id: sw_id)
      next unless work&.active?

      trip!(work, fires, HARD_CEILING, CEILING_WINDOW)
    end
  end

  # Pass C — per-agent anomaly alert, no deactivation.
  def alert_noisy_agents
    counts = scheduled_fires(AGENT_ALERT_WINDOW).group(:agent_id).count
    counts.each do |agent_id, fires|
      next if fires <= AGENT_ALERT_FIRES

      report(
        "[CircuitBreaker] agent=#{agent_id} fired #{fires} scheduled tasks in " \
        "#{minutes(AGENT_ALERT_WINDOW)}m (alert threshold #{AGENT_ALERT_FIRES}) — investigate for a runaway schedule",
        level: :warning,
      )
    end
  end

  # The engine stamps the scheduled_work id into AuditLog.input->>'taskId' on
  # every scheduled run (see engine agent-runner saveAuditLog). Returns
  # { scheduled_work_id(Integer) => fire_count }.
  def fires_by_schedule(window)
    scheduled_fires(window)
      .where("input->>'taskId' IS NOT NULL")
      .group("input->>'taskId'")
      .count
      .each_with_object({}) do |(id_str, count), acc|
        id = Integer(id_str, exception: false)
        acc[id] = count if id
      end
  end

  def scheduled_fires(window)
    AuditLog.where(action: "scheduled_task").where("created_at >= ?", Time.current - window)
  end

  def active_once_work(sw_id)
    work = ScheduledWork.find_by(id: sw_id)
    return nil unless work&.active?
    return nil unless work.mode == "once"

    work
  end

  def trip!(work, fires, limit, window)
    msg = "[CircuitBreaker] Deactivated runaway scheduled_work ##{work.id} " \
          "(agent=#{work.agent_id} mode=#{work.mode} name=#{work.name.inspect}): " \
          "#{fires} fires in #{minutes(window)}m exceeds limit #{limit}"

    work.update_columns(
      active: false,
      payload_extra: (work.payload_extra || {}).merge(
        "deactivated_by" => "circuit_breaker",
        "deactivated_at" => Time.current.utc.iso8601,
        "deactivated_reason" => msg,
      ),
      updated_at: Time.current,
    )

    report(msg, level: :error)
  end

  def report(msg, level:)
    Rails.logger.public_send(level == :error ? :error : :warn, msg)
    Sentry.capture_message(msg, level: level) if defined?(Sentry)
  end

  def minutes(window)
    (window / 60).to_i
  end
end
