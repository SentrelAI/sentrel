require "rails_helper"

RSpec.describe "Integrations (Nango connect modes)", type: :request do
  let(:org)  { create_org(name: "Home Org", onboarding_completed_at: Time.current) }
  let(:user) { create_user(org, email: "founder@example.com", role: "owner") }

  before do
    ActsAsTenant.current_tenant = nil
    sign_in user
  end

  describe "POST /integrations/:service/paste_token" do
    it "stores a Credential and connects the app in byo_token mode" do
      expect {
        post paste_token_integrations_path(service_name: "vercel"), params: { token: "vc_live_x", scope: "org" }
      }.to change { Integration.count }.by(1)
        .and change { Credential.where(provider: "vercel", kind: "generic").count }.by(1)

      expect(response).to have_http_status(:ok)
      intg = Integration.find_by(service_name: "vercel")
      expect(intg.connect_mode).to eq("byo_token")
      expect(intg.status).to eq("connected")
    end

    it "404s an unknown integration" do
      post paste_token_integrations_path(service_name: "nonsense"), params: { token: "x" }
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /integrations/:service/org_config" do
    it "sets byo_oauth mode with app credentials" do
      post org_config_integrations_path(service_name: "github"),
           params: { mode: "byo_oauth", client_id: "cid", client_secret: "csec" }

      expect(response).to have_http_status(:ok)
      cfg = OrgIntegrationConfig.find_by(organization_id: org.id, provider: "github")
      expect(cfg.mode).to eq("byo_oauth")
      expect(cfg.client_id).to eq("cid")
      expect(cfg.client_secret).to eq("csec")
    end

    it "rejects byo_oauth without credentials" do
      post org_config_integrations_path(service_name: "github"), params: { mode: "byo_oauth" }
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "POST /integrations/:service/nango_session" do
    it "mints a Connect session via Nango::Client" do
      allow(Nango::Client).to receive(:configured?).and_return(true)
      allow(Nango::Client).to receive(:create_connect_session).and_return({ "token" => "sess_xyz" })

      post nango_session_integrations_path(service_name: "github"), params: {}
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["session_token"]).to eq("sess_xyz")
      expect(response.parsed_body["provider_config_key"]).to eq("github")
    end

    it "tells the user to paste a token for api_key-only apps" do
      post nango_session_integrations_path(service_name: "vercel"), params: {}
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "POST /integrations/:service/nango_finalize" do
    it "upserts a connected Integration and runs post-connect side effects" do
      allow_any_instance_of(IntegrationsController).to receive(:sync_agents_after_integration_change)

      expect {
        post nango_finalize_integrations_path(service_name: "github"),
             params: { connection_id: "conn_abc", scope: "org" }
      }.to change { Integration.count }.by(1)

      expect(response).to have_http_status(:ok)
      intg = Integration.find_by(service_name: "github")
      expect(intg.connect_mode).to eq("managed")
      expect(intg.nango_connection_id).to eq("conn_abc")
      expect(intg.provider_config_key).to eq("github")
    end
  end
end
