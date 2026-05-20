require "rails_helper"

RSpec.describe Forge::TemplatePack do
  let(:brief) do
    {
      slug: "spec-pack-agent",
      name: "Spec Pack Agent",
      role: "Pack Test",
      category: "starter",
      description: "Test template that integrates analyzer + resolver + generator",
      notes: "for testing",
    }
  end

  let!(:existing_skill) do
    SkillDefinition.create!(
      slug: "spec-send-email-pack",
      name: "Spec Pack Send Email",
      description: "Send email for pack spec",
      category: "communication",
      icon: "mail",
      skill_md: "## When to Use\nuse it\n## Workflow\nworkflow",
      source: "built_in",
      visibility: "marketplace",
      published: true,
      requires_connections: ["gmail"],
    )
  end

  before do
    Forge::SkillResolver.reset_cache!
  end

  after do
    AgentTemplate.find_by(slug: "spec-pack-agent")&.destroy
    existing_skill.destroy
  end

  it "analyzes → resolves locally → generates a template constrained to the resolved skill" do
    # Stub the analyzer to return one requirement we know resolves locally.
    allow_any_instance_of(Forge::SkillRequirementsAnalyzer).to receive(:call).and_return([
      Forge::SkillRequirementsAnalyzer::Requirement.new(
        capability: "send pack email",
        query: "spec pack send email",
        priority: "required",
        rationale: "test",
        composio_toolkit: "gmail",
      ),
    ])

    # Stub the TemplateGenerator's underlying Claude call.
    payload = {
      "slug" => "spec-pack-agent",
      "name" => "Spec Pack Agent",
      "role" => "Pack Test",
      "category" => "starter",
      "description" => "desc",
      "icon" => "TestTube",
      "suggested_provider" => "anthropic",
      "suggested_model" => "claude-sonnet-4-6",
      "suggested_skill_slugs" => ["spec-send-email-pack"],
      "suggested_integrations" => [],
      "capabilities" => {},
      "variables" => ["company_name"],
      "identity_md" => "I am {{agent_name}}.\n\nI report to {{user_name}}.\nI do test things.\nI ship.\nI'm direct.\nI care about correctness.",
      "personality_md" => "I am direct.\nI don't waste words.\nI ask before guessing.\nI ship.\nI shut up and listen.",
      "instructions_md" => "# How I work\n\n## Delegation\n- via tools\n\n## Prioritization\n- one loop at a time\n\n## Escalation\n- brief user",
      "email_signature_md" => "— {{agent_name}}\nPack Test · {{company_name}}",
    }
    allow(Forge::AnthropicClient).to receive(:complete).and_return(payload.to_json)

    result = described_class.new(brief: brief).call

    expect(result).to be_ok
    template = AgentTemplate.find_by(slug: "spec-pack-agent")
    expect(template.suggested_skill_slugs).to eq(["spec-send-email-pack"])
    # Aggregated from the resolved skill's requires_connections
    expect(template.suggested_integrations).to include("gmail")
    expect(template.published).to be true
  end

  it "downgrades to published: false when the lint gate fails" do
    allow_any_instance_of(Forge::SkillRequirementsAnalyzer).to receive(:call).and_return([
      Forge::SkillRequirementsAnalyzer::Requirement.new(
        capability: "send pack email",
        query: "spec pack send email",
        priority: "required",
        rationale: "test",
        composio_toolkit: nil,
      ),
    ])

    # Payload deliberately missing email_signature_md + short copy → fails lint.
    bad_payload = {
      "slug" => "spec-pack-agent",
      "name" => "Spec Pack Agent",
      "role" => "Pack Test",
      "category" => "starter",
      "description" => "desc",
      "icon" => "TestTube",
      "suggested_provider" => "anthropic",
      "suggested_model" => "claude-sonnet-4-6",
      "suggested_skill_slugs" => ["spec-send-email-pack"],
      "suggested_integrations" => [],
      "capabilities" => {},
      "variables" => [],
      "identity_md" => "I am leveraging synergy.",
      "personality_md" => "Direct.",
      "instructions_md" => "# Stuff\n- do things",
    }
    allow(Forge::AnthropicClient).to receive(:complete).and_return(bad_payload.to_json)

    result = described_class.new(brief: brief).call

    expect(result).to be_ok
    template = AgentTemplate.find_by(slug: "spec-pack-agent")
    expect(template.published).to be false
  end
end
