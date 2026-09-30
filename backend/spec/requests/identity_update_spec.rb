require "rails_helper"

# An agent's update_identity card: approving it applies the change before the
# agent hears the decision, records persona revisions, and refuses to
# overwrite an edit made after the card was posted.
RSpec.describe "Identity changes approved from chat", type: :request do
  let(:org) { create_org(name: "Persona Co", onboarding_completed_at: Time.current) }
  let(:user) { create_user(org, email: "owner-#{SecureRandom.hex(3)}@example.com", role: "owner") }
  let(:agent) { create_agent(org, name: "Finch", role: "SDR", personality_md: "Pragmatic.") }
  let(:redis) { instance_double(Redis, publish: 1) }

  before do
    ActsAsTenant.current_tenant = nil
    allow(Redis).to receive(:new).and_return(redis)
    sign_in user
  end

  def card(changes)
    with_tenant(org) do
      PendingApproval.create!(
        organization: org, agent: agent,
        tool_name: "request_approval:identity_update", payload_type: "identity_update",
        approval_token: "act_#{SecureRandom.hex(4)}", status: "pending", summary: "Rename to Maya",
        tool_input: { "changes" => changes, "why" => "user asked" },
      )
    end
  end

  def decide(approval, status)
    patch "/pending_approvals/#{approval.id}",
      params: { decision: status == "approved" ? "approve" : "reject", status: status }.to_json,
      headers: { "Content-Type" => "application/json", "Accept" => "application/json" }
  end

  it "applies an approved change and records the persona revision" do
    approval = card(
      "name" => { "before" => "Finch", "after" => "Maya" },
      "personality_md" => { "before" => "Pragmatic.", "after" => "Warm and concise." },
    )

    decide(approval, "approved")

    expect(agent.reload).to have_attributes(name: "Maya", personality_md: "Warm and concise.")
    revision = with_tenant(org) { agent.persona_revisions.sole }
    expect(revision).to have_attributes(field: "personality_md", before_text: "Pragmatic.", user_id: user.id)
    expect(redis).to have_received(:publish).with("agent-#{agent.id}-approvals", include("\"value\":\"approve\""))
  end

  it "leaves the agent alone when the card is declined" do
    decide(card("name" => { "before" => "Finch", "after" => "Maya" }), "rejected")
    expect(agent.reload.name).to eq("Finch")
  end

  it "won't overwrite an edit made after the card was posted" do
    approval = card("name" => { "before" => "Finch", "after" => "Maya" })
    agent.update!(name: "Robin")

    decide(approval, "approved")

    expect(agent.reload.name).to eq("Robin")
    expect(approval.reload).to have_attributes(status: "rejected", decision: "stale")
    expect(redis).to have_received(:publish).with("agent-#{agent.id}-approvals", include("\"value\":\"stale\""))
  end
end
