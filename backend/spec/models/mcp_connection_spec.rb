require "rails_helper"

# Refresh tokens rotate: every refresh returns a new one and kills the old, so
# a refresh must never run twice for one connection. fresh_access_token!
# serialises on the row lock and, given the digest of the token the server
# rejected, hands back a token someone else already refreshed to instead of
# spending the (now dead) refresh token again.
RSpec.describe McpConnection do
  let(:org) { create_org }
  let(:user) { create_user(org) }
  let(:server) do
    with_tenant(org) do
      McpServer.create!(organization: org, name: "ScribeMD", slug: "scribemd", url: "https://mcp.scribemd.ai/mcp",
                        auth_mode: "oauth", client_id: "c1", token_endpoint: "https://www.scribemd.ai/oauth/token",
                        resource: "https://mcp.scribemd.ai/mcp")
    end
  end
  let(:connection) do
    with_tenant(org) do
      server.connections.create!(organization: org, user: user, access_token: "old-access",
                                 refresh_token: "refresh-1", expires_at: 1.hour.from_now)
    end
  end

  before { ActsAsTenant.current_tenant = nil }

  it "hands out the stored token while it's fresh" do
    expect(Mcp::Oauth).not_to receive(:refresh!)
    expect(connection.fresh_access_token!).to eq("old-access")
  end

  it "refreshes an expired token and keeps the rotated refresh token" do
    connection.update!(expires_at: 1.minute.ago)
    expect(Mcp::Oauth).to receive(:refresh!).with(server, refresh_token: "refresh-1")
      .and_return("access_token" => "new-access", "refresh_token" => "refresh-2", "expires_in" => 3600)

    expect(connection.fresh_access_token!).to eq("new-access")
    expect(connection.reload).to have_attributes(refresh_token: "refresh-2", status: "connected")
    expect(connection.expires_at).to be_within(5.seconds).of(1.hour.from_now)
  end

  it "refreshes when the server rejected the token it holds" do
    expect(Mcp::Oauth).to receive(:refresh!).once.and_return("access_token" => "new-access", "refresh_token" => "refresh-2")
    expect(connection.fresh_access_token!(rejected_digest: McpConnection.token_digest("old-access"))).to eq("new-access")
  end

  it "doesn't refresh twice when another run already replaced the rejected token" do
    connection.update!(access_token: "already-refreshed", refresh_token: "refresh-2")
    expect(Mcp::Oauth).not_to receive(:refresh!)
    expect(connection.fresh_access_token!(rejected_digest: McpConnection.token_digest("old-access"))).to eq("already-refreshed")
  end

  it "asks the user to sign in again when the refresh fails" do
    connection.update!(expires_at: 1.minute.ago)
    allow(Mcp::Oauth).to receive(:refresh!).and_raise("token endpoint 400: invalid_grant")

    expect(connection.fresh_access_token!).to be_nil
    expect(connection.reload).to have_attributes(status: "needs_sign_in", last_error: include("invalid_grant"))
  end
end
