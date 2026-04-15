require "rails_helper"

RSpec.describe Agent, type: :model do
  let(:org) { create_org }

  it "validates required fields" do
    agent = Agent.new(organization: org)
    expect(agent).not_to be_valid
    expect(agent.errors[:name]).to include("can't be blank")
    expect(agent.errors[:slug]).to include("can't be blank")
    expect(agent.errors[:role]).to include("can't be blank")
  end

  it "validates status inclusion" do
    agent = Agent.new(organization: org, name: "A", slug: "a", role: "SDR", status: "bogus")
    expect(agent).not_to be_valid
    expect(agent.errors[:status]).to be_present
  end

  it "validates slug uniqueness within organization" do
    with_tenant(org) do
      create_agent(org, slug: "unique-slug")
      duplicate = Agent.new(organization: org, name: "B", slug: "unique-slug", role: "SDR", status: "running")
      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:slug]).to include("has already been taken")
    end
  end

  it "creates with valid attributes" do
    agent = create_agent(org)
    expect(agent).to be_persisted
    expect(agent.status).to eq("running")
  end

  it "has dependent destroy on conversations" do
    with_tenant(org) do
      agent = create_agent(org)
      conv = create_conversation(agent)
      create_message(conv)
      expect { agent.destroy }.to change(Conversation, :count).by(-1)
        .and change(Message, :count).by(-1)
    end
  end
end
