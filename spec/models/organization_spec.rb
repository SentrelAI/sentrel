require "rails_helper"

RSpec.describe Organization, type: :model do
  it "validates required fields" do
    org = Organization.new
    expect(org).not_to be_valid
    expect(org.errors[:name]).to include("can't be blank")
    expect(org.errors[:slug]).to include("can't be blank")
  end

  it "validates slug uniqueness" do
    create_org(slug: "unique-org")
    dup = Organization.new(name: "Dup", slug: "unique-org")
    expect(dup).not_to be_valid
    expect(dup.errors[:slug]).to include("has already been taken")
  end

  it "creates with valid attributes" do
    org = create_org
    expect(org).to be_persisted
  end

  it "cascades destroy to agents and users" do
    org = create_org
    create_agent(org)
    create_user(org)
    expect { org.destroy }.to change(Agent, :count).by(-1)
      .and change(User, :count).by(-1)
  end
end
