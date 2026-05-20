require "rails_helper"

RSpec.describe Forge::TemplateGenerator do
  let(:valid_brief) do
    {
      slug: "spec-test-agent",
      name: "Spec Test Agent",
      role: "Spec Test",
      category: "starter",
      description: "A test template generated under spec",
      notes: "for testing purposes only",
    }
  end

  let(:valid_payload) do
    {
      "slug" => "spec-test-agent",
      "name" => "Spec Test Agent",
      "role" => "Spec Test",
      "category" => "starter",
      "description" => "A test template generated under spec",
      "icon" => "TestTube",
      "suggested_provider" => "anthropic",
      "suggested_model" => "claude-sonnet-4-6",
      "suggested_skill_slugs" => [],
      "suggested_integrations" => [],
      "capabilities" => { "knowledge_base" => { "enabled" => true } },
      "variables" => ["company_name"],
      "identity_md" => "I am {{agent_name}}.",
      "personality_md" => "Direct.",
      "instructions_md" => "# How I work\n## Section\n- do things",
      "email_signature_md" => "— {{agent_name}}\nSpec Test · {{company_name}}",
    }
  end

  after { AgentTemplate.find_by(slug: "spec-test-agent")&.destroy }

  it "happy path creates an AgentTemplate from a stubbed Claude response" do
    allow(Forge::AnthropicClient).to receive(:complete).and_return(valid_payload.to_json)

    result = described_class.new(brief: valid_brief).call

    expect(result).to be_ok
    template = AgentTemplate.find_by(slug: "spec-test-agent")
    expect(template).to be_present
    expect(template.email_signature_md).to include("{{agent_name}}")
    expect(template.system_template).to be true
    expect(template.published).to be true
  end

  it "rejects responses missing required fields" do
    bad_payload = valid_payload.merge("identity_md" => "")
    allow(Forge::AnthropicClient).to receive(:complete).and_return(bad_payload.to_json)

    result = described_class.new(brief: valid_brief).call

    expect(result.ok?).to be false
    expect(result.error).to match(/identity_md/)
  end

  it "truncates email_signature_md to 500 chars" do
    long_sig = "—" + ("x" * 600)
    allow(Forge::AnthropicClient).to receive(:complete).and_return(valid_payload.merge("email_signature_md" => long_sig).to_json)

    result = described_class.new(brief: valid_brief).call

    expect(result).to be_ok
    expect(result.template.email_signature_md.length).to be <= 500
  end

  it "filters suggested_skill_slugs to those in the available pool" do
    payload = valid_payload.merge("suggested_skill_slugs" => %w[real-slug fake-slug])
    allow(Forge::AnthropicClient).to receive(:complete).and_return(payload.to_json)

    result = described_class.new(brief: valid_brief, available_skills: ["real-slug"]).call

    expect(result.template.suggested_skill_slugs).to eq(["real-slug"])
  end
end
