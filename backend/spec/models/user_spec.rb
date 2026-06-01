require "rails_helper"

RSpec.describe User, type: :model do
  let(:org_a) { create_org(name: "Org A") }
  let(:org_b) { create_org(name: "Org B") }

  describe "membership lifecycle" do
    it "auto-creates a membership for the active org on create" do
      user = create_user(org_a, role: "owner")
      expect(user.memberships.pluck(:organization_id, :role)).to eq([ [ org_a.id, "owner" ] ])
    end

    it "exposes joined orgs through the has_many :through" do
      user = create_user(org_a)
      user.memberships.create!(organization: org_b, role: "member")
      expect(user.organizations).to contain_exactly(org_a, org_b)
    end

    it "mirrors a role change onto the active org's membership" do
      user = create_user(org_a, role: "member")
      user.update!(role: "admin")
      expect(user.memberships.find_by(organization_id: org_a.id).role).to eq("admin")
    end
  end

  describe "#member_of?" do
    it "is true only for orgs the user belongs to" do
      user = create_user(org_a)
      expect(user.member_of?(org_a)).to be(true)
      expect(user.member_of?(org_b)).to be(false)
      expect(user.member_of?(nil)).to be_falsey
    end
  end

  describe "#switch_to!" do
    it "repoints the active org and realigns role to the target membership" do
      user = create_user(org_a, role: "owner")
      user.memberships.create!(organization: org_b, role: "viewer")

      user.switch_to!(org_b)

      expect(user.reload.organization_id).to eq(org_b.id)
      expect(user.role).to eq("viewer")
    end

    it "refuses to switch into an org the user isn't a member of" do
      user = create_user(org_a)
      expect { user.switch_to!(org_b) }.to raise_error(ActiveRecord::RecordNotFound)
      expect(user.reload.organization_id).to eq(org_a.id)
    end
  end

  describe "#member_of_multiple_organizations?" do
    it "reflects how many orgs the user belongs to" do
      user = create_user(org_a)
      expect(user.member_of_multiple_organizations?).to be(false)
      user.memberships.create!(organization: org_b, role: "member")
      expect(user.member_of_multiple_organizations?).to be(true)
    end
  end
end
