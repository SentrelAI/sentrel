require "rails_helper"

RSpec.describe "Organizations (user-facing)", type: :request do
  # Home org must have onboarding done, else ApplicationController#redirect_to_onboarding
  # intercepts requests before our actions run.
  let(:home_org) { create_org(name: "Home Org", onboarding_completed_at: Time.current) }
  let(:user) { create_user(home_org, email: "founder@example.com", role: "owner") }

  before { ActsAsTenant.current_tenant = nil }

  describe "POST /organizations" do
    before { sign_in user }

    it "creates a new org, makes the user its owner, and switches into it" do
      expect {
        post organizations_path, params: { name: "Second Co" }
      }.to change { Organization.count }.by(1)
        .and change { user.reload.memberships.count }.by(1)

      new_org = Organization.find_by(name: "Second Co")
      expect(user.organization_id).to eq(new_org.id)
      expect(user.memberships.find_by(organization_id: new_org.id).role).to eq("owner")
    end

    it "funnels the user into onboarding for the fresh org" do
      post organizations_path, params: { name: "Second Co" }

      new_org = Organization.find_by(name: "Second Co")
      expect(new_org.onboarding_completed_at).to be_nil
      expect(response).to redirect_to(onboarding_path)
    end

    it "keeps the user a member of their original org too" do
      post organizations_path, params: { name: "Second Co" }
      expect(user.reload.member_of?(home_org)).to be(true)
      expect(user.organizations.count).to eq(2)
    end

    it "defaults a blank name and still creates the org" do
      expect {
        post organizations_path, params: { name: "  " }
      }.to change { Organization.count }.by(1)
      expect(Organization.last.name).to eq("My Organization")
    end
  end

  describe "POST /organizations/:id/switch" do
    let(:other_org) { create_org(name: "Other Co") }

    before do
      user.memberships.create!(organization: other_org, role: "member")
      sign_in user
    end

    it "switches the active org for an org the user belongs to" do
      post switch_organization_path(other_org)

      expect(user.reload.organization_id).to eq(other_org.id)
      expect(user.role).to eq("member")
      expect(response).to redirect_to(dashboard_path)
    end

    it "refuses to switch into an org the user is not a member of" do
      stranger_org = create_org(name: "Stranger Co")

      post switch_organization_path(stranger_org)

      expect(user.reload.organization_id).to eq(home_org.id)
      expect(response).to redirect_to(dashboard_path)
      follow_redirect!
      expect(flash[:alert]).to match(/don't have access/)
    end
  end

  describe "authentication" do
    it "requires a signed-in user to create an org" do
      expect {
        post organizations_path, params: { name: "Nope" }
      }.not_to change { Organization.count }
      expect(response).to redirect_to(new_user_session_path)
    end
  end
end
