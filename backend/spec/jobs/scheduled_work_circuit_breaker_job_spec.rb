require "rails_helper"

RSpec.describe ScheduledWorkCircuitBreakerJob, type: :job do
  let(:org) { create_org }
  let(:agent) { create_agent(org) }

  def create_work(attrs = {})
    ScheduledWork.create!({
      organization: org,
      agent: agent,
      mode: "once",
      name: "Follow-up",
      instruction: "check the thread",
      fire_at: 1.day.ago,
      active: true
    }.merge(attrs))
  end

  # Mimics how the engine records a scheduled run: action=scheduled_task with
  # the scheduled_work id stamped into input->>'taskId'.
  def fire!(work, at: Time.current)
    AuditLog.create!(
      organization: org,
      agent: agent,
      action: "scheduled_task",
      input: { "taskId" => work.id.to_s, "jobId" => SecureRandom.uuid },
      status: "success",
      created_at: at,
    )
  end

  it "deactivates a `once` schedule that fired more than twice in 24h" do
    work = create_work
    3.times { fire!(work) }

    described_class.new.perform

    expect(work.reload.active).to be(false)
    expect(work.payload_extra["deactivated_by"]).to eq("circuit_breaker")
    expect(work.payload_extra["deactivated_reason"]).to include("3 fires")
  end

  it "leaves a healthy `once` schedule that fired exactly once alone" do
    work = create_work
    fire!(work)

    described_class.new.perform

    expect(work.reload.active).to be(true)
  end

  it "ignores fires older than the 24h window for the once rule" do
    work = create_work
    3.times { fire!(work, at: 2.days.ago) }

    described_class.new.perform

    expect(work.reload.active).to be(true)
  end

  it "deactivates any mode that blows the hard hourly ceiling" do
    work = create_work(mode: "interval", interval_seconds: 1800, fire_at: nil)
    (described_class::HARD_CEILING + 1).times { fire!(work, at: 10.minutes.ago) }

    described_class.new.perform

    expect(work.reload.active).to be(false)
  end

  it "does not deactivate an interval schedule firing at a normal rate" do
    work = create_work(mode: "interval", interval_seconds: 1800, fire_at: nil)
    2.times { fire!(work, at: 10.minutes.ago) }

    described_class.new.perform

    expect(work.reload.active).to be(true)
  end

  it "alerts (without deactivating) when one agent's total fire count is anomalous" do
    # Spread fires across many healthy-looking interval rows so no single row
    # trips, but the agent total crosses the alert threshold.
    expect(Rails.logger).to receive(:warn).with(/fired .* scheduled tasks/).at_least(:once)

    rows = Array.new(described_class::AGENT_ALERT_FIRES + 5) do
      create_work(mode: "interval", interval_seconds: 1800, fire_at: nil)
    end
    rows.each { |w| fire!(w, at: 5.minutes.ago) }

    described_class.new.perform

    expect(rows.map { |w| w.reload.active }).to all(be(true))
  end
end
