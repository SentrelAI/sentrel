require "rails_helper"

RSpec.describe Nango::Proxy do
  let(:org)   { create_org }
  let(:agent) { with_tenant(org) { create_agent(org) } }

  # HTTP response double that also answers header access (res["x-..."]) — the
  # proxy now reads rate-limit headers, so bare instance_doubles aren't enough.
  def http_resp(code:, body:, headers: {})
    instance_double(Net::HTTPResponse, code: code, body: body).tap do |r|
      allow(r).to receive(:[]) { |k| headers[k.to_s.downcase] }
    end
  end

  def integration(mode:, service: "github", **attrs)
    with_tenant(org) do
      Integration.create!({
        organization: org,
        service_name: service,
        scope: "org",
        status: "connected",
        connect_mode: mode,
        nango_connection_id: (mode == "byo_token" ? nil : "conn_123"),
        provider_config_key: (mode == "byo_token" ? nil : "github"),
      }.merge(attrs))
    end
  end

  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("NANGO_BASE_URL", anything).and_return("http://nango.test:3003")
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("NANGO_SECRET_KEY").and_return("nango-secret")
  end

  describe "managed/byo_oauth → Nango proxy" do
    it "routes through Nango with Connection-Id + Provider-Config-Key headers" do
      intg = integration(mode: "managed")
      captured = nil
      fake = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake)
      allow(fake).to receive(:request) do |req|
        captured = req
        http_resp(code: "200", body: { ok: true }.to_json)
      end

      res = described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")

      expect(res.status).to eq(200)
      expect(res.body).to eq("ok" => true)
      expect(captured["Authorization"]).to eq("Bearer nango-secret")
      expect(captured["Connection-Id"]).to eq("conn_123")
      expect(captured["Provider-Config-Key"]).to eq("github")
      expect(captured.uri.to_s).to eq("http://nango.test:3003/proxy/user")
    end
  end

  describe "byo_token → direct provider call with pasted key" do
    it "calls the provider api_base_url with the Credential token" do
      intg = integration(mode: "byo_token", service: "vercel")
      with_tenant(org) do
        Credential.create!(organization: org, provider: "vercel", kind: "generic",
                           name: "vercel-key", fields: { "value" => "vc_secret" })
      end
      captured = nil
      fake = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake)
      allow(fake).to receive(:request) do |req|
        captured = req
        http_resp(code: "200", body: "[]")
      end

      res = described_class.call(agent: agent, integration: intg, method: "GET", path: "/v2/deployments")

      expect(res.source).to eq("byo_token")
      expect(captured["Authorization"]).to eq("Bearer vc_secret")
      expect(captured.uri.to_s).to eq("https://api.vercel.com/v2/deployments")
    end
  end

  describe "per-agent ACL" do
    it "rejects a write when the agent policy is read_only" do
      intg = integration(mode: "managed")
      with_tenant(org) do
        AgentToolPolicy.create!(organization: org, agent: agent, toolkit_slug: "github", preset: "read_only")
      end

      expect {
        described_class.call(agent: agent, integration: intg, method: "POST", path: "/repos/x/y/issues")
      }.to raise_error(Nango::Proxy::Forbidden)
    end

    it "allows a read when the agent policy is read_only" do
      intg = integration(mode: "managed")
      with_tenant(org) do
        AgentToolPolicy.create!(organization: org, agent: agent, toolkit_slug: "github", preset: "read_only")
      end
      allow(Net::HTTP).to receive(:start).and_return(
        http_resp(code: "200", body: "{}")
      )
      allow(Net::HTTP).to receive(:start).and_yield(
        instance_double(Net::HTTP).tap { |h| allow(h).to receive(:request).and_return(
          http_resp(code: "200", body: "{}")) }
      )

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      }.not_to raise_error
    end
  end

  describe "approval gate" do
    it "raises ApprovalRequired for a write to a gated provider until approved" do
      intg = integration(mode: "managed", service: "linkedin", provider_config_key: "linkedin")

      expect {
        described_class.call(agent: agent, integration: intg, method: "POST", path: "/v2/ugcPosts")
      }.to raise_error(Nango::Proxy::ApprovalRequired)
    end

    it "does not gate reads on gated providers" do
      intg = integration(mode: "managed", service: "linkedin", provider_config_key: "linkedin")
      allow(Net::HTTP).to receive(:start).and_yield(
        instance_double(Net::HTTP).tap { |h| allow(h).to receive(:request).and_return(
          http_resp(code: "200", body: "{}")) }
      )

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/v2/me")
      }.not_to raise_error
    end
  end

  describe "reliability" do
    before { allow(described_class).to receive(:sleep) } # don't actually wait

    it "retries a transient 5xx then succeeds (agent never sees the blip)" do
      intg = integration(mode: "managed")
      calls = 0
      fake = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake)
      allow(fake).to receive(:request) do
        calls += 1
        calls < 2 ? http_resp(code: "503", body: "bad gateway") : http_resp(code: "200", body: "{}")
      end

      res = described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      expect(res.status).to eq(200)
      expect(calls).to eq(2) # retried once
    end

    it "raises Transient after exhausting retries on network errors" do
      intg = integration(mode: "managed")
      allow(Net::HTTP).to receive(:start).and_raise(Errno::ECONNRESET)

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      }.to raise_error(Nango::Proxy::Transient)
    end

    it "raises AuthExpired + marks the integration error on 401" do
      intg = integration(mode: "managed")
      fake = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake)
      allow(fake).to receive(:request).and_return(http_resp(code: "401", body: "bad token"))

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      }.to raise_error(Nango::Proxy::AuthExpired)
      expect(intg.reload.status).to eq("error")
    end

    it "raises RateLimited with retry_after on 429" do
      intg = integration(mode: "managed")
      fake = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake)
      allow(fake).to receive(:request).and_return(
        http_resp(code: "429", body: "slow down", headers: { "retry-after" => "42" })
      )

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      }.to raise_error(Nango::Proxy::RateLimited) { |e| expect(e.retry_after).to eq(42) }
    end
  end

  describe "audit logging" do
    it "writes an AuditLog row on success" do
      intg = integration(mode: "managed")
      allow(Net::HTTP).to receive(:start).and_yield(
        instance_double(Net::HTTP).tap { |h| allow(h).to receive(:request).and_return(
          http_resp(code: "200", body: "{}")) }
      )

      expect {
        described_class.call(agent: agent, integration: intg, method: "GET", path: "/user")
      }.to change { AuditLog.where(action: "nango_proxy").count }.by(1)
    end
  end
end
