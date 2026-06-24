require "rails_helper"

RSpec.describe Nango::Health do
  let(:org) { create_org }

  def integration(status: "connected", mode: "managed", **attrs)
    with_tenant(org) do
      Integration.create!({
        organization: org, service_name: "github", scope: "org", status: status,
        connect_mode: mode,
        nango_connection_id: (mode == "byo_token" ? nil : "conn_1"),
        provider_config_key: (mode == "byo_token" ? nil : "github")
      }.merge(attrs))
    end
  end

  describe ".check" do
    it "is :ok when Nango reports no errors" do
      intg = integration
      allow(Nango::Client).to receive(:get_connection).and_return("errors" => [])
      expect(described_class.check(intg)).to eq(:ok)
    end

    it "is :error when Nango reports errors" do
      intg = integration
      allow(Nango::Client).to receive(:get_connection).and_return("errors" => [ { "type" => "auth" } ])
      expect(described_class.check(intg)).to eq(:error)
    end

    it "is :error when the connection is gone (404)" do
      intg = integration
      allow(Nango::Client).to receive(:get_connection).and_raise(Nango::Client::Error.new("nango 404: not found"))
      expect(described_class.check(intg)).to eq(:error)
    end

    it "is :unknown for byo_token (not checkable)" do
      expect(described_class.check(integration(mode: "byo_token"))).to eq(:unknown)
    end

    it "is :unknown on a transient lookup failure (don't flip on a blip)" do
      intg = integration
      allow(Nango::Client).to receive(:get_connection).and_raise(Nango::Client::Error.new("nango 503"))
      expect(described_class.check(intg)).to eq(:unknown)
    end
  end

  describe ".sweep" do
    before { allow(described_class).to receive(:sync_agents) }

    it "marks a broken connection error and heals a recovered one" do
      broken = integration(status: "connected")
      recovered = integration(status: "error", nango_connection_id: "conn_2")
      allow(Nango::Client).to receive(:get_connection).with("conn_1", "github").and_return("errors" => [ { "x" => 1 } ])
      allow(Nango::Client).to receive(:get_connection).with("conn_2", "github").and_return("errors" => [])

      result = described_class.sweep
      expect(broken.reload.status).to eq("error")
      expect(recovered.reload.status).to eq("connected")
      expect(result[:broken]).to eq(1)
      expect(result[:healed]).to eq(1)
    end
  end
end
