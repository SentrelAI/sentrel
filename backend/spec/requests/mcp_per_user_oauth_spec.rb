require "rails_helper"

# OAuth MCP servers (ScribeMD, Linear…) are signed into per user. The server
# row is shared; each sign-in lands on the signing-in user's own connection,
# and the engine only ever gets the token of the user a run acts for.
RSpec.describe "Per-user OAuth for MCP servers", type: :request do
  let(:org) { create_org(name: "Scribe Co", onboarding_completed_at: Time.current) }
  let(:alice) { create_user(org, email: "alice-#{SecureRandom.hex(3)}@example.com") }
  let(:bob) { create_user(org, email: "bob-#{SecureRandom.hex(3)}@example.com") }
  let(:agent) { create_agent(org, name: "Finch") }
  let(:secret) { { "X-Engine-Secret" => "s3cret" } }
  let(:server) do
    with_tenant(org) do
      McpServer.create!(organization: org, name: "ScribeMD templates", slug: "scribemd_templates",
                        url: "https://www.scribemd.ai/mcp/templates", auth_mode: "oauth", client_id: "client-1",
                        scopes: [ "mcp:templates" ], resource: "https://www.scribemd.ai/mcp/templates",
                        issuer: "https://www.scribemd.ai", authorize_endpoint: "https://www.scribemd.ai/oauth/authorize",
                        token_endpoint: "https://www.scribemd.ai/oauth/token",
                        registered_redirect_uri: "http://www.example.com/oauth/mcp/callback")
    end
  end

  before do
    ActsAsTenant.current_tenant = nil
    allow(Redis).to receive(:new).and_return(instance_double(Redis, publish: 1))
    stub_const("ENV", ENV.to_h.merge("ENGINE_API_SECRET" => "s3cret"))
  end

  def sign_in_to_server_as(user, tokens:)
    sign_in user
    get "/mcp_servers/#{server.id}/connect"
    authorize = URI(response.location)
    params = URI.decode_www_form(authorize.query).to_h
    allow(Mcp::Oauth).to receive(:exchange_code).and_return(tokens)
    get "/oauth/mcp/callback", params: { code: "code-#{user.id}", state: params["state"] }
    params
  end

  it "asks for the challenge scope, binds the token to the resource, and stores it for that user" do
    params = sign_in_to_server_as(alice, tokens: { "access_token" => "alice-access", "refresh_token" => "alice-refresh", "expires_in" => 3600 })

    expect(params).to include("scope" => "mcp:templates", "resource" => "https://www.scribemd.ai/mcp/templates",
                              "code_challenge_method" => "S256", "redirect_uri" => "http://www.example.com/oauth/mcp/callback")
    connection = with_tenant(org) { server.connection_for(alice) }
    expect(connection).to have_attributes(access_token: "alice-access", refresh_token: "alice-refresh", status: "connected")
    expect(with_tenant(org) { server.connection_for(bob) }).to be_nil
  end

  it "gives each user their own connection" do
    sign_in_to_server_as(alice, tokens: { "access_token" => "alice-access", "refresh_token" => "r1" })
    sign_in_to_server_as(bob, tokens: { "access_token" => "bob-access", "refresh_token" => "r2" })

    expect(with_tenant(org) { server.connections.count }).to eq(2)
    expect(with_tenant(org) { server.connection_for(bob).access_token }).to eq("bob-access")
  end

  it "re-authorizes with the scope a 403 said was missing" do
    with_tenant(org) { server.connections.create!(organization: org, user: alice, access_token: "a", refresh_token: "r") }
    post "/api/mcp_servers/#{server.id}/auth_error",
      params: { agent_id: agent.id, user_id: alice.id, kind: "insufficient_scope", scope: "mcp:write" }, headers: secret

    params = sign_in_to_server_as(alice, tokens: { "access_token" => "wider", "refresh_token" => "r2", "scope" => "mcp:templates mcp:write" })
    expect(params["scope"]).to eq("mcp:templates mcp:write")
    expect(with_tenant(org) { server.connection_for(alice) }).to have_attributes(status: "connected", scopes: %w[mcp:templates mcp:write])
  end

  describe "GET /api/mcp_servers" do
    before do
      with_tenant(org) do
        server.connections.create!(organization: org, user: alice, access_token: "alice-access", refresh_token: "r",
                                   expires_at: 1.hour.from_now)
        McpServer.create!(organization: org, name: "Meta Ads", slug: "meta_ads", url: "https://sentrel-meta-mcp.fly.dev/mcp",
                          access_token: "workspace-token", status: "connected")
      end
    end

    def servers_for(user_id)
      get "/api/mcp_servers", params: { agent_id: agent.id, user_id: user_id }.compact, headers: secret
      response.parsed_body["mcp_servers"].to_h { |s| [ s["name"], s["access_token"] ] }
    end

    it "gives a run the sign-in of the user it acts for, plus workspace servers" do
      expect(servers_for(alice.id)).to eq("scribemd_templates" => "alice-access", "meta_ads" => "workspace-token")
    end

    it "gives other users and user-less runs only the workspace servers" do
      expect(servers_for(bob.id)).to eq("meta_ads" => "workspace-token")
      expect(servers_for(nil)).to eq("meta_ads" => "workspace-token")
    end

    it "ignores a user outside the agent's workspace" do
      outsider = create_user(create_org, email: "x-#{SecureRandom.hex(3)}@example.com")
      with_tenant(org) { server.connections.create!(organization: org, user: outsider, access_token: "leak", refresh_token: "r") }
      expect(servers_for(outsider.id)).to eq("meta_ads" => "workspace-token")
    end
  end

  describe "POST /api/mcp_servers/:id/refresh" do
    let!(:connection) do
      with_tenant(org) { server.connections.create!(organization: org, user: alice, access_token: "old", refresh_token: "r1") }
    end

    it "refreshes the rejected token" do
      allow(Mcp::Oauth).to receive(:refresh!).and_return("access_token" => "new", "refresh_token" => "r2")
      post "/api/mcp_servers/#{server.id}/refresh",
        params: { agent_id: agent.id, user_id: alice.id, rejected_digest: McpConnection.token_digest("old") }, headers: secret
      expect(response.parsed_body).to eq("access_token" => "new")
      expect(connection.reload.refresh_token).to eq("r2")
    end

    it "answers 401 when the user has to sign in again" do
      allow(Mcp::Oauth).to receive(:refresh!).and_raise("invalid_grant")
      post "/api/mcp_servers/#{server.id}/refresh",
        params: { agent_id: agent.id, user_id: alice.id, rejected_digest: McpConnection.token_digest("old") }, headers: secret
      expect(response).to have_http_status(:unauthorized)
      expect(connection.reload.status).to eq("needs_sign_in")
    end
  end

  it "marks a connection that's still rejected after a refresh as needing sign-in" do
    connection = with_tenant(org) { server.connections.create!(organization: org, user: alice, access_token: "a", refresh_token: "r") }
    post "/api/mcp_servers/#{server.id}/auth_error", params: { agent_id: agent.id, user_id: alice.id, kind: "unauthorized" }, headers: secret
    expect(connection.reload.status).to eq("needs_sign_in")
  end

  it "disconnecting signs out only the current user" do
    with_tenant(org) do
      server.connections.create!(organization: org, user: alice, access_token: "a", refresh_token: "r")
      server.connections.create!(organization: org, user: bob, access_token: "b", refresh_token: "r")
    end
    sign_in alice
    delete "/mcp_servers/#{server.id}", headers: { "Accept" => "application/json" }

    expect(with_tenant(org) { server.reload.connections.map(&:user_id) }).to eq([ bob.id ])
  end

  it "treats a workspace token as workspace-level by default" do
    expect(McpServer.new.auth_mode).to eq("token")
  end
end
