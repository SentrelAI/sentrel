class Api::SpendCapsController < ApplicationController
  skip_before_action :verify_authenticity_token

  before_action :verify_engine_secret!

  # GET /api/spend_caps/check?agent_id=N
  # Returns the cap config + current spend for the agent. Engine consults
  # this before each run and aborts when over-cap.
  #
  # Response shape:
  #   {
  #     daily_cap_usd: 5.0 | null,
  #     monthly_cap_usd: 200.0 | null,
  #     notify_threshold_pct: 0.8,
  #     notified_today: false,
  #     spend_today_usd: 1.23,
  #     spend_month_usd: 45.67,
  #     over_daily: false,
  #     over_monthly: false,
  #     should_notify: false        # threshold crossed, not yet notified today
  #   }
  def check
    agent = Agent.find(params.require(:agent_id))
    daily = agent.spend_daily_cap_usd
    monthly = agent.spend_monthly_cap_usd
    threshold = agent.spend_notify_threshold_pct.to_f

    today = AuditLog.where(agent_id: agent.id)
                   .where("created_at >= ?", Time.current.utc.beginning_of_day)
                   .sum(:total_cost_usd).to_f
    month = AuditLog.where(agent_id: agent.id)
                   .where("created_at >= ?", Time.current.utc.beginning_of_month)
                   .sum(:total_cost_usd).to_f

    over_daily = daily.present? && today >= daily.to_f
    over_monthly = monthly.present? && month >= monthly.to_f
    notified_today = agent.spend_notified_on == Date.current
    crossing_threshold = daily.present? && threshold > 0 && today >= (daily.to_f * threshold) && !over_daily

    # Mobile push when the agent first crosses a hard cap today. Deduped via
    # spend_cap_pushed_on so the engine's per-run check doesn't re-notify on
    # every subsequent over-cap run until UTC midnight.
    if (over_daily || over_monthly) && agent.spend_cap_pushed_on != Date.current
      push_spend_cap_exceeded(agent, over_daily: over_daily, today: today, month: month, daily: daily, monthly: monthly)
      agent.update_column(:spend_cap_pushed_on, Date.current)
    end

    render json: {
      daily_cap_usd: daily&.to_f,
      monthly_cap_usd: monthly&.to_f,
      notify_threshold_pct: threshold,
      notified_today: notified_today,
      spend_today_usd: today.round(4),
      spend_month_usd: month.round(4),
      over_daily: over_daily,
      over_monthly: over_monthly,
      should_notify: crossing_threshold && !notified_today
    }
  end

  # POST /api/spend_caps/mark_notified?agent_id=N
  # Engine calls this after posting the "approaching cap" message so we
  # don't notify again until UTC midnight.
  def mark_notified
    agent = Agent.find(params.require(:agent_id))
    agent.update!(spend_notified_on: Date.current)
    head :no_content
  end

  private

  # Notify every member of the agent's org that it blew through a cap. Members
  # (not just active-org users) so a notification reaches people regardless of
  # which org is currently selected on their device.
  def push_spend_cap_exceeded(agent, over_daily:, today:, month:, daily:, monthly:)
    user_ids = Membership.where(organization_id: agent.organization_id).pluck(:user_id)
    return if user_ids.empty?

    body = if over_daily
      "#{agent.name} hit its daily spend cap ($#{format('%.2f', today)} / $#{format('%.2f', daily.to_f)})."
    else
      "#{agent.name} hit its monthly spend cap ($#{format('%.2f', month)} / $#{format('%.2f', monthly.to_f)})."
    end

    MobilePushJob.perform_later(
      user_ids: user_ids,
      title: "Spend cap reached",
      body: body,
      data: { type: "spend_cap", agent_id: agent.to_param }
    )
  rescue => e
    Rails.logger.warn("[SpendCaps] mobile push failed: #{e.class}: #{e.message}")
  end

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
