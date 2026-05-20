require "rails_helper"

RSpec.describe Forge::SkillResolver do
  let(:requirement) do
    Forge::SkillRequirementsAnalyzer::Requirement.new(
      capability: "send email via Gmail",
      query: "send gmail email",
      priority: "required",
      rationale: "test",
      composio_toolkit: "gmail",
    )
  end

  before do
    Forge::SkillResolver.reset_cache!
    # Make resolver deterministic by disabling generation fallback unless
    # explicitly under test.
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("SKILLS_SH_API_KEY").and_return(nil)
  end

  describe "local match (ILIKE)" do
    let!(:existing_skill) do
      SkillDefinition.create!(
        slug: "spec-send-email",
        name: "Send Email via Gmail",
        description: "Compose and send Gmail messages",
        category: "communication",
        icon: "mail",
        skill_md: "test body",
        source: "built_in",
        visibility: "marketplace",
        published: true,
      )
    end

    after { existing_skill.destroy }

    it "finds the existing skill on token-overlap match" do
      result = described_class.new(requirement: requirement, allow_generate: false).call
      expect(result.ok?).to be true
      expect(result.via).to eq("local")
      expect(result.skill.slug).to eq("spec-send-email")
    end

    it "caches the resolution so a second call doesn't re-query DB" do
      # First call hits DB.
      first = described_class.new(requirement: requirement, allow_generate: false).call
      expect(first.via).to eq("local")

      # Second call must hit cache — we prove it by destroying the row.
      # If cache works, we still get our result back.
      existing_skill.delete   # avoid callbacks; just remove the row
      second = described_class.new(requirement: requirement, allow_generate: false).call
      expect(second.ok?).to be true
      expect(second.skill.slug).to eq("spec-send-email")
    end
  end

  describe "Composio toolkit backfill" do
    let!(:skill_without_gmail) do
      SkillDefinition.create!(
        slug: "spec-email-no-gmail",
        name: "Send Gmail Email",
        description: "Send Gmail",
        category: "communication",
        icon: "mail",
        skill_md: "body",
        source: "built_in",
        visibility: "marketplace",
        published: true,
        requires_connections: [],
      )
    end

    after { skill_without_gmail.destroy }

    it "adds the requirement's toolkit to the resolved skill's requires_connections" do
      result = described_class.new(requirement: requirement, allow_generate: false).call
      skill_without_gmail.reload
      expect(skill_without_gmail.requires_connections).to include("gmail")
      expect(result.ok?).to be true
    end
  end

  describe "all sources exhausted" do
    it "returns an error when no source produces a skill and allow_generate: false" do
      lonely_req = Forge::SkillRequirementsAnalyzer::Requirement.new(
        capability: "manage Antarctic penguin colonies via space station",
        query: "antarctic penguin space station nonexistent zzz",
        priority: "required",
        rationale: "test",
        composio_toolkit: nil,
      )
      result = described_class.new(requirement: lonely_req, allow_generate: false).call
      expect(result.ok?).to be false
      expect(result.error).to be_present
    end
  end
end
