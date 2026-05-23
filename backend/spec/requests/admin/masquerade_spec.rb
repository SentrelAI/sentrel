require "rails_helper"

RSpec.describe "Admin masquerade", type: :request do
  # onboarding_completed_at must be set or ApplicationController#redirect_to_onboarding
  # intercepts every request and the masquerade action never runs.
  let(:org) { create_org(onboarding_completed_at: Time.current) }
  let(:admin) { create_user(org, email: "admin@test.com", platform_admin: true) }
  let(:other_admin) { create_user(org, email: "other-admin@test.com", platform_admin: true) }
  let(:target) { create_user(org, email: "regular@test.com", platform_admin: false) }

  # The auth pipeline runs before set_tenant; with no current_user the tenant
  # is nil, but a few before_actions still touch it. Make sure each request
  # gets a fresh tenant context.
  before { ActsAsTenant.current_tenant = nil }

  describe "POST /admin/users/:id/masquerade" do
    context "when not a platform admin" do
      it "redirects with an error" do
        non_admin = create_user(org, email: "nope@test.com", platform_admin: false)
        sign_in non_admin
        expect { post masquerade_admin_user_path(target) }
          .not_to change { AuditLog.count }
        expect(response).to redirect_to(root_path)
      end
    end

    context "when platform admin and target is a regular user" do
      before { sign_in admin }

      it "swaps the Devise session to the target and stores the impersonator id" do
        post masquerade_admin_user_path(target)
        expect(response).to redirect_to(root_path)
        expect(session["warden.user.user.key"]&.first&.first).to eq(target.id)
        expect(session[:impersonator_id]).to eq(admin.id)
      end

      it "writes a masquerade_start audit log" do
        expect { post masquerade_admin_user_path(target) }
          .to change { AuditLog.where(action: "masquerade_start").count }.by(1)
        log = AuditLog.where(action: "masquerade_start").last
        expect(log.acting_user_id).to eq(admin.id)
        expect(log.input["target_user_id"]).to eq(target.id)
      end
    end

    context "safety guards" do
      before { sign_in admin }

      it "refuses self-masquerade" do
        post masquerade_admin_user_path(admin)
        expect(session[:impersonator_id]).to be_nil
        expect(flash[:alert]).to match(/yourself/i)
      end

      it "refuses to masquerade as another platform admin" do
        post masquerade_admin_user_path(other_admin)
        expect(session[:impersonator_id]).to be_nil
      end

      it "refuses nested masquerade" do
        post masquerade_admin_user_path(target) # first swap succeeds
        expect(session[:impersonator_id]).to eq(admin.id)
        second = create_user(org, email: "second@test.com", platform_admin: false)
        # current_user is now target, who is not a platform admin → admin gate
        # bounces us before the nested check fires. Verifies the outer gate.
        post masquerade_admin_user_path(second)
        expect(response).to redirect_to(root_path)
      end
    end
  end

  describe "DELETE /masquerade" do
    it "restores the admin session and audit-logs the stop" do
      sign_in admin
      post masquerade_admin_user_path(target)
      expect(session[:impersonator_id]).to eq(admin.id)

      expect { delete masquerade_path }
        .to change { AuditLog.where(action: "masquerade_stop").count }.by(1)

      expect(session[:impersonator_id]).to be_nil
      expect(session["warden.user.user.key"]&.first&.first).to eq(admin.id)
    end

    it "no-ops when not masquerading" do
      sign_in admin
      expect { delete masquerade_path }
        .not_to change { AuditLog.count }
      expect(response).to redirect_to(root_path)
    end

    it "requires authentication" do
      delete masquerade_path
      expect(response).to redirect_to(new_user_session_path)
    end
  end
end
