require "rails_helper"

RSpec.describe Membership, type: :model do
  let(:org) { create_org }

  it "is created automatically for a new user's active org" do
    user = create_user(org)
    expect(user.memberships.count).to eq(1)
    membership = user.memberships.first
    expect(membership.organization_id).to eq(org.id)
    expect(membership.role).to eq(user.role)
  end

  it "validates role inclusion" do
    user = create_user(org)
    m = Membership.new(user: user, organization: create_org, role: "bogus")
    expect(m).not_to be_valid
    expect(m.errors[:role]).to be_present
  end

  it "enforces one membership per (user, organization)" do
    user = create_user(org)
    dup = Membership.new(user: user, organization: org, role: "member")
    expect(dup).not_to be_valid
    expect(dup.errors[:user_id]).to include("is already a member of this organization")
  end

  it "treats owner and admin as admin?" do
    user = create_user(org)
    expect(Membership.new(role: "owner")).to be_admin
    expect(Membership.new(role: "admin")).to be_admin
    expect(Membership.new(role: "member")).not_to be_admin
  end

  it "is destroyed when its organization is destroyed" do
    org_b = create_org
    user = create_user(org)
    user.memberships.create!(organization: org_b, role: "member")
    expect { org_b.destroy }.to change { Membership.where(organization_id: org_b.id).count }.to(0)
    expect(User.exists?(user.id)).to be(true) # user survives — they still belong to org
  end
end
