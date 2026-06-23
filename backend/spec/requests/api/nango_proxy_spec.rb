require "rails_helper"

RSpec.describe "Api::Integrations (engine-facing Nango)", type: :request do
  let(:engine_secret) { "test-engine-secret" }
  let(:org)   { create_org }
  let(:agent) { with_tenant(org) { create_agent(org) } }

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:[]).with("ENGINE_API_SECRET").and_return(engine_secret)
    allow(ENV).to receive(:[]).with("NANGO_SECRET_KEY").and_return("nango-secret")
    allow(ENV).to receive(:fetch).with("NANGO_BASE_URL", anything).and_return("http://nango.test:3003")
  end

  let(:headers) { { "X-Engine-Secret" => engine_secret } }

  def connect!(service:, mode: "managed")
    with_tenant(org) do
      Integration.create!(organization: org, service_name: service, scope: "org", status: "connected",
                          connect_mode: mode,
                          nango_connection_id: (mode == "byo_token" ? nil : "conn_1"),
                          provider_config_key: (mode == "byo_token" ? nil : service))
    end
  end

  describe "GET /api/integrations" do
    it "returns the agent's connected providers with api_base_url + tool" do
      connect!(service: "github")
      get "/api/integrations", params: { agent_id: agent.id }, headers: headers

      expect(response).to have_http_status(:ok)
      items = response.parsed_body["integrations"]
      gh = items.find { |i| i["provider"] == "github" }
      expect(gh["api_base_url"]).to eq("https://api.github.com")
      expect(gh["tool"]).to eq("proxy")
      expect(gh["connect_mode"]).to eq("managed")
    end

    it "401s without the engine secret" do
      get "/api/integrations", params: { agent_id: agent.id }
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/nango_proxy" do
    it "404s with needs_connection when the provider isn't connected" do
      post "/api/nango_proxy", params: { agent_id: agent.id, provider: "github", method: "GET", path: "/user" }, headers: headers
      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body["needs_connection"]).to be(true)
    end

    it "proxies a connected provider through Nango::Proxy" do
      connect!(service: "github")
      allow(Nango::Proxy).to receive(:call).and_return(
        Nango::Proxy::Result.new(status: 200, body: { "login" => "octocat" }, source: "managed")
      )

      post "/api/nango_proxy", params: { agent_id: agent.id, provider: "github", method: "GET", path: "/user" }, headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["body"]).to eq("login" => "octocat")
    end

    it "returns 202 when approval is required" do
      connect!(service: "linkedin")
      allow(Nango::Proxy).to receive(:call).and_raise(Nango::Proxy::ApprovalRequired)

      post "/api/nango_proxy", params: { agent_id: agent.id, provider: "linkedin", method: "POST", path: "/v2/ugcPosts" }, headers: headers
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body["requires_approval"]).to be(true)
    end

    it "returns 403 when the agent policy forbids it" do
      connect!(service: "github")
      allow(Nango::Proxy).to receive(:call).and_raise(Nango::Proxy::Forbidden.new("nope"))

      post "/api/nango_proxy", params: { agent_id: agent.id, provider: "github", method: "POST", path: "/x" }, headers: headers
      expect(response).to have_http_status(:forbidden)
    end
  end
end
