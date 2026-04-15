require "rails_helper"

RSpec.describe DailySummaryJob, type: :job do
  let(:org) { create_org }
  let(:agent) { create_agent(org) }
  let(:date) { Date.new(2026, 4, 9) }

  before do
    ActsAsTenant.current_tenant = org
  end

  after do
    ActsAsTenant.current_tenant = nil
  end

  it "creates an AgentSummary for agents with activity" do
    conv = create_conversation(agent)

    # 3 inbound messages
    3.times do
      create_message(conv, direction: "inbound", channel: "web",
                     created_at: date.beginning_of_day + 10.hours)
    end

    # 1 email via a different channel
    create_message(conv, direction: "inbound", channel: "email",
                   created_at: date.beginning_of_day + 11.hours)

    # 1 email_sent audit log
    AuditLog.create!(
      organization: org, agent: agent,
      action: "email_sent", status: "success",
      created_at: date.beginning_of_day + 12.hours
    )

    # 1 approval (approved)
    PendingApproval.create!(
      organization: org, agent: agent,
      tool_name: "send_email", status: "approved",
      created_at: date.beginning_of_day + 13.hours
    )

    # 1 error audit log
    AuditLog.create!(
      organization: org, agent: agent,
      action: "tool_call", status: "failed",
      created_at: date.beginning_of_day + 14.hours
    )

    described_class.new.perform(date.to_s)

    summary = AgentSummary.find_by(agent: agent, date: date)
    expect(summary).to be_present
    expect(summary.messages_handled).to eq(4) # 3 web + 1 email
    expect(summary.emails_sent).to eq(1)
    expect(summary.approvals_approved).to eq(1)
    expect(summary.errors_count).to eq(1)
    expect(summary.channel_breakdown).to eq({ "web" => 3, "email" => 1 })
  end

  it "skips agents with no activity" do
    _idle_agent = create_agent(org, slug: "idle-agent")

    described_class.new.perform(date.to_s)

    expect(AgentSummary.count).to eq(0)
  end

  it "updates existing summary on re-run" do
    conv = create_conversation(agent)
    create_message(conv, direction: "inbound", channel: "web",
                   created_at: date.beginning_of_day + 10.hours)

    described_class.new.perform(date.to_s)
    expect(AgentSummary.count).to eq(1)

    # Add more messages and re-run
    2.times do
      create_message(conv, direction: "inbound", channel: "web",
                     created_at: date.beginning_of_day + 15.hours)
    end

    described_class.new.perform(date.to_s)
    expect(AgentSummary.count).to eq(1) # still 1, not duplicated
    expect(AgentSummary.first.messages_handled).to eq(3)
  end

  it "counts conversations started on that date" do
    create_conversation(agent, created_at: date.beginning_of_day + 8.hours)
    create_conversation(agent, created_at: date.beginning_of_day + 9.hours)

    # Need at least 1 message for the summary to be created (total > 0 check)
    conv = agent.conversations.first
    create_message(conv, direction: "inbound", channel: "web",
                   created_at: date.beginning_of_day + 10.hours)

    described_class.new.perform(date.to_s)

    summary = AgentSummary.find_by(agent: agent, date: date)
    expect(summary.conversations_started).to eq(2)
  end

  it "defaults to yesterday when no date given" do
    conv = create_conversation(agent)
    create_message(conv, direction: "inbound", channel: "web",
                   created_at: Date.yesterday.beginning_of_day + 10.hours)

    described_class.new.perform
    expect(AgentSummary.find_by(agent: agent, date: Date.yesterday)).to be_present
  end
end
