require "rails_helper"

RSpec.describe PendingApproval, type: :model do
  let(:org) { create_org }
  let(:agent) { create_agent(org) }

  it "validates tool_name presence" do
    pa = PendingApproval.new(organization: org, agent: agent)
    expect(pa).not_to be_valid
    expect(pa.errors[:tool_name]).to include("can't be blank")
  end

  it "validates status inclusion" do
    pa = PendingApproval.new(organization: org, agent: agent, tool_name: "send_email", status: "maybe")
    expect(pa).not_to be_valid
    expect(pa.errors[:status]).to be_present
  end

  it "defaults status to pending" do
    pa = with_tenant(org) do
      PendingApproval.create!(organization: org, agent: agent, tool_name: "send_email")
    end
    expect(pa.status).to eq("pending")
  end

  it "transitions from pending to approved" do
    pa = with_tenant(org) do
      PendingApproval.create!(organization: org, agent: agent, tool_name: "send_email")
    end
    pa.update!(status: "approved")
    expect(pa.reload.status).to eq("approved")
  end

  it "transitions from pending to rejected" do
    pa = with_tenant(org) do
      PendingApproval.create!(organization: org, agent: agent, tool_name: "send_email")
    end
    pa.update!(status: "rejected")
    expect(pa.reload.status).to eq("rejected")
  end
end
