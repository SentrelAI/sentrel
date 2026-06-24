require "rails_helper"

RSpec.describe Nango::Client do
  let(:org)  { create_org }
  let(:user) { create_user(org) }

  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("NANGO_BASE_URL", anything).and_return("http://nango.test:3003")
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("NANGO_SECRET_KEY").and_return("nango-secret")
  end

  # Minimal stand-in for a Net::HTTPResponse — Client#parse checks
  # `is_a?(Net::HTTPSuccess)`, so model that on the status code.
  class FakeResponse
    def initialize(code, body) = (@code, @body = code, body)
    attr_reader :code, :body
    def is_a?(klass) = klass == Net::HTTPSuccess ? @code.to_s.start_with?("2") : super
  end

  def stub_post(response_body: { token: "sess_abc" }.to_json, code: "200")
    captured = {}
    fake = instance_double(Net::HTTP)
    allow(Net::HTTP).to receive(:start).and_yield(fake)
    allow(fake).to receive(:request) do |req|
      captured[:req] = req
      captured[:body] = JSON.parse(req.body) if req.body
      FakeResponse.new(code, response_body)
    end
    captured
  end

  describe ".create_connect_session" do
    it "posts end_user + allowed_integrations and returns the session token" do
      captured = stub_post
      res = described_class.create_connect_session(
        organization: org, user: user, provider_config_key: "github"
      )

      expect(res["token"]).to eq("sess_abc")
      expect(captured[:req]["Authorization"]).to eq("Bearer nango-secret")
      expect(captured[:body]["allowed_integrations"]).to eq([ "github" ])
      expect(captured[:body]["end_user"]["id"]).to eq("org_#{org.id}")
      expect(captured[:body]).not_to have_key("integrations_config_defaults")
    end

    it "passes BYO oauth overrides as integration config defaults" do
      captured = stub_post
      described_class.create_connect_session(
        organization: org, user: user, provider_config_key: "github",
        byo_overrides: { oauth_client_id_override: "cid", oauth_client_secret_override: "csec" }
      )

      defaults = captured[:body]["integrations_config_defaults"]["github"]["connection_config"]
      expect(defaults["oauth_client_id_override"]).to eq("cid")
      expect(defaults["oauth_client_secret_override"]).to eq("csec")
    end
  end

  describe ".configured?" do
    it "is true when the secret key is present" do
      expect(described_class.configured?).to be(true)
    end
  end
end
