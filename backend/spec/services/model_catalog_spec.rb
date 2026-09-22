require "rails_helper"

RSpec.describe ModelCatalog do
  def create_model(provider:, model_id:, name:, featured: false, **attrs)
    CatalogModel.create!(
      provider: provider, model_id: model_id, name: name, featured: featured,
      tool_call: true, context_limit: 1_000_000, cost_input: 3, cost_output: 15,
      release_date: Date.new(2026, 7, 1), **attrs
    )
  end

  describe "with synced models" do
    before do
      create_model(provider: "anthropic", model_id: "claude-opus-9", name: "Claude Opus 9", featured: true)
      create_model(provider: "openrouter", model_id: "openai/gpt-9", name: "GPT-9", featured: true)
      create_model(provider: "openrouter", model_id: "openai/gpt-8", name: "GPT-8")
    end

    it "groups the featured models by provider" do
      groups = described_class.groups

      expect(groups.map { |g| g[:group] }).to eq([ described_class::ANTHROPIC_GROUP, described_class::OPENROUTER_GROUP ])
      expect(groups.first[:options].first[:model_id]).to eq("claude-opus-9")
    end

    it "hides the subscription group unless the org connected one" do
      expect(described_class.groups.map { |g| g[:group] }).not_to include(described_class::SUBSCRIPTION_GROUP)
    end

    it "puts the subscription group first when connected, routed to anthropic_account" do
      groups = described_class.groups(anthropic_account_connected: true)

      expect(groups.first[:group]).to eq(described_class::SUBSCRIPTION_GROUP)
      expect(groups.first[:options].map { |o| o[:provider] }).to all(eq("anthropic_account"))
      expect(groups.first[:options].first[:model_id]).to eq("claude-opus-9")
    end

    it "builds a price + context hint from the synced columns" do
      hint = described_class.groups.first[:options].first[:hint]

      expect(hint).to eq("$3/$15 per M · 1M context")
    end

    it "flattens with the group name attached, for the Telegram picker" do
      flat = described_class.flat

      expect(flat.map { |o| o[:model_id] }).to eq(%w[claude-opus-9 openai/gpt-9])
      expect(flat.first[:group]).to eq(described_class::ANTHROPIC_GROUP)
    end

    it "returns every published model from .all, not just the featured ones" do
      ids = described_class.all.map { |m| m[:model_id] }

      expect(ids).to match_array(%w[claude-opus-9 openai/gpt-9 openai/gpt-8])
    end

    it "excludes unpublished models" do
      CatalogModel.find_by!(model_id: "openai/gpt-8").update!(published: false)

      expect(described_class.all.map { |m| m[:model_id] }).not_to include("openai/gpt-8")
    end

    it "offers the Claude models under anthropic_account too when connected" do
      all = described_class.all(anthropic_account_connected: true)

      expect(all.count { |m| m[:model_id] == "claude-opus-9" }).to eq(2)
      expect(all.map { |m| m[:provider] }).to include("anthropic_account")
    end
  end

  describe "before the first sync" do
    it "falls back to the list in the picker component" do
      expect(CatalogModel.count).to eq(0)

      groups = described_class.groups

      expect(groups).not_to be_empty
      expect(groups.flat_map { |g| g[:options] }).to all(include(:provider, :model_id, :label))
    end
  end

  describe ".default_model" do
    it "picks the newest featured Claude" do
      create_model(provider: "anthropic", model_id: "claude-opus-9", name: "Claude Opus 9", featured: true,
                   release_date: Date.new(2026, 7, 1))
      create_model(provider: "anthropic", model_id: "claude-sonnet-10", name: "Claude Sonnet 10", featured: true,
                   release_date: Date.new(2026, 9, 1))
      # Newer, but not featured (e.g. a date-pinned duplicate) or not Anthropic.
      create_model(provider: "anthropic", model_id: "claude-sonnet-10-20260901", name: "pinned",
                   release_date: Date.new(2026, 9, 2))
      create_model(provider: "openrouter", model_id: "openai/gpt-10", name: "GPT-10", featured: true,
                   release_date: Date.new(2026, 9, 3))

      expect(described_class.default_model).to eq("claude-sonnet-10")
    end

    it "honors an admin-pinned position over release date" do
      create_model(provider: "anthropic", model_id: "claude-opus-9", name: "Claude Opus 9", featured: true,
                   release_date: Date.new(2026, 7, 1), position: -1)
      create_model(provider: "anthropic", model_id: "claude-sonnet-10", name: "Claude Sonnet 10", featured: true,
                   release_date: Date.new(2026, 9, 1))

      expect(described_class.default_model).to eq("claude-opus-9")
    end

    it "falls back before the first sync" do
      expect(described_class.default_model).to eq(ModelCatalog::FALLBACK_DEFAULT_MODEL)
    end
  end
end
