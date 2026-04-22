require "rails_helper"

RSpec.describe EngineSync do
  let(:org) { create_org }
  let(:agent) { with_tenant(org) { create_agent(org) } }

  describe ".trigger" do
    it "no-ops when ENGINE_URL is not set" do
      stub_const("ENV", ENV.to_hash.merge("ENGINE_URL" => nil))
      expect(Net::HTTP).not_to receive(:start)
      described_class.trigger(agent)
    end

    it "POSTs to <ENGINE_URL>/sync with the engine secret header" do
      fake_http = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(fake_http)
      captured_req = nil
      allow(fake_http).to receive(:request) do |req|
        captured_req = req
        Net::HTTPSuccess.allocate
      end

      with_env("ENGINE_URL" => "http://engine.test", "ENGINE_API_SECRET" => "s3cret") do
        described_class.trigger(agent)
      end

      expect(captured_req).to be_a(Net::HTTP::Post)
      expect(captured_req.path).to eq("/sync")
      expect(captured_req["X-Engine-Secret"]).to eq("s3cret")
      expect(captured_req["Content-Type"]).to eq("application/json")
    end

    it "swallows network errors without raising" do
      allow(Net::HTTP).to receive(:start).and_raise(SocketError.new("boom"))
      expect {
        with_env("ENGINE_URL" => "http://engine.test") do
          described_class.trigger(agent)
        end
      }.not_to raise_error
    end
  end

  def with_env(overrides)
    original = overrides.keys.to_h { |k| [k, ENV[k]] }
    overrides.each { |k, v| ENV[k] = v }
    yield
  ensure
    original.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end
end
