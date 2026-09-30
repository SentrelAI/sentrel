require "rails_helper"

# The agent's in-chat "Connect <name> MCP" card: probe what a server needs,
# connect it (public / token / OAuth via dynamic client registration), and
# resolve the proposal so the agent resumes with the new tools.
RSpec.describe "Connecting MCP servers from chat", type: :request do
  let(:org) { create_org(name: "Mcp Co", onboarding_completed_at: Time.current) }
  let(:user) { create_user(org, email: "owner-#{SecureRandom.hex(3)}@example.com", role: "owner") }
  let(:agent) { create_agent(org, name: "Finch") }
  let(:json) { { "Content-Type" => "application/json", "Accept" => "application/json" } }
  let(:redis) { instance_double(Redis, publish: 1) }

  before do
    ActsAsTenant.current_tenant = nil
    allow(Redis).to receive(:new).and_return(redis)
    allow(Resolv).to receive(:getaddresses).and_return([ "104.18.1.1" ])
    sign_in user
  end

  def proposal
    @proposal ||= with_tenant(org) do
      PendingApproval.create!(
        organization: org, agent: agent,
        tool_name: "request_approval:connection_proposal", payload_type: "connection_proposal",
        approval_token: "mcp_linear_#{SecureRandom.hex(4)}", status: "pending",
        summary: "Connect Linear MCP — to file the bug",
        tool_input: { "kind" => "mcp", "url" => "https://mcp.linear.app/mcp", "label" => "Linear" },
      )
    end
  end

  describe "POST /mcp_servers/probe" do
    it "reports a public server as needing no auth" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :none })
      post "/mcp_servers/probe", params: { url: "https://mcp.deepwiki.com/mcp" }.to_json, headers: json
      expect(response.parsed_body).to include("auth" => "none", "host" => "mcp.deepwiki.com")
    end

    it "reports oauth only when the server can register a client" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :required, resource_metadata: nil })
      allow(Mcp::Oauth).to receive(:discover).and_return({ registration_endpoint: "https://x.test/register" })
      post "/mcp_servers/probe", params: { url: "https://mcp.linear.app/mcp" }.to_json, headers: json
      expect(response.parsed_body["auth"]).to eq("oauth")

      allow(Mcp::Oauth).to receive(:discover).and_return({ registration_endpoint: nil })
      post "/mcp_servers/probe", params: { url: "https://mcp.linear.app/mcp" }.to_json, headers: json
      expect(response.parsed_body["auth"]).to eq("token")
    end

    it "refuses URLs that resolve to private addresses or aren't https" do
      allow(Resolv).to receive(:getaddresses).with("internal.example").and_return([ "10.0.0.5" ])
      post "/mcp_servers/probe", params: { url: "https://internal.example/mcp" }.to_json, headers: json
      expect(response).to have_http_status(:unprocessable_entity)

      post "/mcp_servers/probe", params: { url: "http://mcp.deepwiki.com/mcp" }.to_json, headers: json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "POST /mcp_servers" do
    it "connects a public server for the proposing agent and resumes it" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :none })
      post "/mcp_servers",
        params: { name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", approval_token: proposal.approval_token }.to_json,
        headers: json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("connected" => true, "auth_mode" => "none")
      server = with_tenant(org) { McpServer.find_by!(slug: "deepwiki") }
      expect(server.agent_id).to eq(agent.id)
      expect(proposal.reload).to have_attributes(status: "approved", decision: "connected")
      expect(redis).to have_received(:publish).with("agent-#{agent.id}-approvals", include("\"value\":\"connected\""))
    end

    it "sets up OAuth with a dynamically registered client" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :required, resource_metadata: nil })
      allow(Mcp::Oauth).to receive(:discover).and_return(
        issuer: "https://mcp.linear.app", authorize_endpoint: "https://mcp.linear.app/authorize",
        token_endpoint: "https://mcp.linear.app/token", registration_endpoint: "https://mcp.linear.app/register",
        scopes: %w[read write],
      )
      allow(Mcp::Oauth).to receive(:register_client).and_return("client-123")

      post "/mcp_servers", params: { name: "Linear", url: "https://mcp.linear.app/mcp" }.to_json, headers: json

      expect(response).to have_http_status(:created)
      server = with_tenant(org) { McpServer.find_by!(slug: "linear") }
      expect(server).to have_attributes(client_id: "client-123", auth_mode: "oauth", status: "disconnected")
      expect(response.parsed_body["connect_url"]).to eq("/mcp_servers/#{server.id}/connect")
    end

    it "rejects a token the server refuses" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :required, resource_metadata: nil })
      post "/mcp_servers",
        params: { name: "Acme", url: "https://mcp.acme.example/mcp", access_token: "nope" }.to_json,
        headers: json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body).to include("needs_token" => true)
      expect(with_tenant(org) { McpServer.exists?(slug: "acme") }).to be(false)
    end

    it "never takes a built-in engine server's name" do
      allow(Mcp::Oauth).to receive(:probe).and_return({ auth: :none })
      post "/mcp_servers", params: { name: "Browser", url: "https://mcp.browser.example/mcp" }.to_json, headers: json
      expect(response.parsed_body["slug"]).to eq("browser_mcp")
    end
  end

  describe "GET /api/mcp_servers" do
    it "hands the engine a public server with no token" do
      with_tenant(org) do
        McpServer.create!(organization: org, agent: agent, name: "DeepWiki", slug: "deepwiki",
                          url: "https://mcp.deepwiki.com/mcp", auth_mode: "none", status: "connected")
      end
      stub_const("ENV", ENV.to_h.merge("ENGINE_API_SECRET" => "s3cret"))

      get "/api/mcp_servers", params: { agent_id: agent.id }, headers: { "X-Engine-Secret" => "s3cret" }

      expect(response.parsed_body["mcp_servers"]).to contain_exactly(
        include("name" => "deepwiki", "access_token" => nil),
      )
    end
  end
end
