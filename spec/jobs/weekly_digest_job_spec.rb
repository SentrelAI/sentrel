require "rails_helper"

RSpec.describe WeeklyDigestJob, type: :job do
  let(:org) { create_org }
  let(:owner) { create_user(org, role: "owner") }
  let(:agent) { create_agent(org) }

  before { ActsAsTenant.current_tenant = org }
  after { ActsAsTenant.current_tenant = nil }

  it "sends digest to org owners when there are summaries" do
    owner # ensure created

    AgentSummary.create!(
      organization: org, agent: agent,
      date: 3.days.ago.to_date,
      messages_handled: 15, emails_sent: 3,
      approvals_approved: 2, approvals_rejected: 1,
      tasks_completed: 4, conversations_started: 5,
      errors_count: 1, channel_breakdown: { "web" => 10, "email" => 5 }
    )

    expect {
      described_class.new.perform
    }.to have_enqueued_mail(WeeklyDigestMailer, :digest)
  end

  it "skips orgs with no summaries" do
    owner # ensure created

    expect {
      described_class.new.perform
    }.not_to have_enqueued_mail(WeeklyDigestMailer, :digest)
  end

  it "only sends to owners, not members" do
    owner
    create_user(org, role: "member")

    AgentSummary.create!(
      organization: org, agent: agent,
      date: 2.days.ago.to_date,
      messages_handled: 5, emails_sent: 1,
      tasks_completed: 1, conversations_started: 1,
    )

    expect {
      described_class.new.perform
    }.to have_enqueued_mail(WeeklyDigestMailer, :digest).once
  end
end
