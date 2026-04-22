require "rails_helper"

RSpec.describe Agent, "capabilities" do
  let(:org) { create_org }

  def build(caps = {})
    with_tenant(org) { create_agent(org, capabilities: caps) }
  end

  describe "#effective_capabilities" do
    it "returns defaults when capabilities is empty" do
      agent = build({})
      effective = agent.effective_capabilities
      expect(effective["knowledge_base"]["enabled"]).to eq(false)
      expect(effective["knowledge_base"]["threshold"]).to eq(0.75)
      expect(effective["knowledge_base"]["top_k"]).to eq(5)
      expect(effective["knowledge_base"]["always_retrieve"]).to eq(true)
      %w[scheduling tasks integrations recall send_media].each do |k|
        expect(effective[k]["enabled"]).to eq(true), "expected #{k}.enabled default to be true"
      end
    end

    it "merges stored values over defaults" do
      agent = build("knowledge_base" => { "enabled" => true, "threshold" => 0.85 })
      effective = agent.effective_capabilities
      expect(effective["knowledge_base"]["enabled"]).to eq(true)
      expect(effective["knowledge_base"]["threshold"]).to eq(0.85)
      # top_k and always_retrieve come from the default
      expect(effective["knowledge_base"]["top_k"]).to eq(5)
      expect(effective["knowledge_base"]["always_retrieve"]).to eq(true)
    end

    it "allows disabling a default-on capability" do
      agent = build("scheduling" => { "enabled" => false })
      expect(agent.effective_capabilities["scheduling"]["enabled"]).to eq(false)
      # other caps unaffected
      expect(agent.effective_capabilities["tasks"]["enabled"]).to eq(true)
    end
  end

  describe "#capability_enabled?" do
    it "returns true for default-on caps" do
      agent = build({})
      expect(agent.capability_enabled?(:scheduling)).to eq(true)
      expect(agent.capability_enabled?(:tasks)).to eq(true)
    end

    it "returns false for knowledge_base by default" do
      agent = build({})
      expect(agent.capability_enabled?(:knowledge_base)).to eq(false)
    end

    it "accepts symbol and string keys equivalently" do
      agent = build("knowledge_base" => { "enabled" => true })
      expect(agent.capability_enabled?(:knowledge_base)).to eq(true)
      expect(agent.capability_enabled?("knowledge_base")).to eq(true)
    end
  end
end
