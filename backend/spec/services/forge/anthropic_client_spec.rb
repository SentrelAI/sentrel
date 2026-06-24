require "rails_helper"

RSpec.describe Forge::AnthropicClient do
  describe ".parse_json" do
    it "strips ```json fences" do
      expect(described_class.parse_json("```json\n{\"a\":1}\n```")).to eq("a" => 1)
    end

    it "strips bare ``` fences" do
      expect(described_class.parse_json("```\n{\"a\":1}\n```")).to eq("a" => 1)
    end

    it "trims leading prose before the first JSON token" do
      raw = "Sure, here's the JSON:\n{\"x\":2}"
      expect(described_class.parse_json(raw)).to eq("x" => 2)
    end

    it "handles arrays" do
      expect(described_class.parse_json("[1,2,3]")).to eq([ 1, 2, 3 ])
    end

    it "raises Forge::AnthropicClient::Error on unparseable input" do
      expect { described_class.parse_json("totally not json") }.to raise_error(described_class::Error, /JSON parse failed/)
    end
  end

  describe "usage counters" do
    before { described_class.reset_usage! }

    it "starts at zero after reset" do
      expect(described_class.usage_total).to eq(input_tokens: 0, output_tokens: 0, calls: 0)
    end

    it "accumulates input + output tokens across calls" do
      described_class.send(:record_usage!, { "usage" => { "input_tokens" => 100, "output_tokens" => 50 } }, "claude-sonnet-4-6")
      described_class.send(:record_usage!, { "usage" => { "input_tokens" => 200, "output_tokens" => 75 } }, "claude-sonnet-4-6")
      expect(described_class.usage_total).to eq(input_tokens: 300, output_tokens: 125, calls: 2)
    end

    it "is thread-safe under concurrent record_usage!" do
      described_class.reset_usage!
      threads = Array.new(10) do
        Thread.new do
          100.times { described_class.send(:record_usage!, { "usage" => { "input_tokens" => 1, "output_tokens" => 1 } }, "test") }
        end
      end
      threads.each(&:join)
      expect(described_class.usage_total[:calls]).to eq(1000)
    end
  end
end
