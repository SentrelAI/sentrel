require "rails_helper"

RSpec.describe Invitation, type: :model do
  let(:home_org) { create_org(name: "Home Org") }
  let(:other_org) { create_org(name: "Other Org") }
  let(:user) { create_user(home_org, email: "person@example.com", role: "owner") }

  def invite_to(org, email:, role: "member")
    inv = nil
    ActsAsTenant.with_tenant(org) do
      inv = org.invitations.create!(
        email: email,
        role: role,
        invited_by: create_user(org, email: "inviter-#{SecureRandom.hex(3)}@example.com")
      )
    end
    inv
  end

  describe "#refresh_expiry!" do
    it "pushes a lapsed invitation's expiry back into the future so the link works again" do
      invitation = invite_to(other_org, email: user.email)
      invitation.update_column(:expires_at, 2.days.ago)
      expect(invitation.expired?).to be(true)

      invitation.refresh_expiry!

      expect(invitation.reload.expired?).to be(false)
      expect(invitation.pending?).to be(true)
      expect(invitation.expires_at).to be > Time.current
    end
  end

  describe "#accept!" do
    it "adds the user to the org WITHOUT removing their existing membership" do
      invitation = invite_to(other_org, email: user.email, role: "member")

      expect { invitation.accept!(user) }.to change { user.memberships.count }.from(1).to(2)

      expect(user.member_of?(home_org)).to be(true)
      expect(user.member_of?(other_org)).to be(true)
    end

    it "switches the user's active org to the one they just joined" do
      invitation = invite_to(other_org, email: user.email, role: "admin")

      invitation.accept!(user)

      expect(user.reload.organization_id).to eq(other_org.id)
      # users.role tracks the active org and mirrors the membership role.
      expect(user.role).to eq("admin")
    end

    it "records the role on the membership for the joined org" do
      invitation = invite_to(other_org, email: user.email, role: "viewer")

      invitation.accept!(user)

      membership = user.memberships.find_by(organization_id: other_org.id)
      expect(membership.role).to eq("viewer")
      # The home-org membership keeps its original role.
      expect(user.memberships.find_by(organization_id: home_org.id).role).to eq("owner")
    end

    it "marks the invitation accepted" do
      invitation = invite_to(other_org, email: user.email)
      expect { invitation.accept!(user) }.to change { invitation.reload.accepted_at }.from(nil)
    end

    it "is idempotent on the membership when re-accepting is attempted" do
      invitation = invite_to(other_org, email: user.email, role: "member")
      invitation.accept!(user)
      expect { invitation.accept!(user) }.to raise_error(/already used/)
      expect(user.memberships.where(organization_id: other_org.id).count).to eq(1)
    end
  end
end
