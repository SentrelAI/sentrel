require "rails_helper"
require "tmpdir"

# Point 5 machinery: a template exported to a bundle and re-imported must come
# back the same. Proves BundleExporter ⇄ BundleImporter are faithful inverses,
# which is what makes retiring the Ruby seed catalog safe.
RSpec.describe AgentTemplates::BundleExporter do
  let(:template) do
    ActsAsTenant.without_tenant do
      AgentTemplate.create!(
        slug: "roundtrip-role",
        name: "Roundtrip Role",
        role: "Tester",
        description: "A role for verifying export/import fidelity.",
        icon: "Bug",
        category: "engineering",
        system_template: true,
        published: true,
        suggested_provider: "anthropic",
        suggested_model: "claude-opus-4-8",
        suggested_skill_slugs: %w[web-search send-email],
        suggested_integrations: %w[github linear],
        capabilities: { "knowledge_base" => { "enabled" => true }, "send_media" => { "enabled" => false } },
        identity_md: "I am {{agent_name}}.",
        personality_md: "Terse.",
        instructions_md: "# How I work\nDo the thing.",
        variables: %w[company_name],
      )
    end
  end

  before do
    # The seeds reference built-in/platform skills by slug; classify them as such.
    %w[web-search send-email].each do |slug|
      SkillDefinition.find_or_create_by!(slug: slug) do |s|
        s.name = slug.titleize
        s.description = "Built-in #{slug}"
        s.source = "built_in"
        s.skill_md = "# #{slug.titleize}\n\nBuilt-in platform skill."
      end
    end
  end

  it "produces a schema-shaped agent.yaml with builtin_skills + capabilities" do
    h = described_class.new(template).manifest_hash
    expect(h["spec"]).to eq(AgentBundles::Manifest::SPEC)
    expect(h["builtin_skills"]).to match_array(%w[web-search send-email])
    expect(h["capabilities"]).to eq(template.capabilities)
    expect(h["category"]).to eq("engineering")
    expect(h.dig("model", "id")).to eq("claude-opus-4-8")
    expect(h["inputs"]).to include(a_hash_including("key" => "company_name"))
  end

  it "round-trips: export → import reproduces the template's key fields" do
    Dir.mktmpdir do |root|
      dir = described_class.new(template).write_to(root)

      imported = AgentTemplates::BundleImporter.new(
        dir: dir,
        source_url: "https://github.com/SentrelAI/agent-templates/tree/main/roundtrip-role",
        source_ref: "main",
      ).call

      expect(imported.suggested_skill_slugs).to match_array(template.suggested_skill_slugs)
      expect(imported.suggested_integrations).to match_array(template.suggested_integrations)
      expect(imported.capabilities).to eq(template.capabilities)
      expect(imported.suggested_model).to eq(template.suggested_model)
      expect(imported.variables).to match_array(template.variables)
      expect(imported.icon).to eq(template.icon)
      expect(imported.category).to eq(template.category)
      expect(imported.identity_md).to eq(template.identity_md)
      expect(imported.source_url).to be_present
      expect(imported.system_template).to be(true)
    end
  end
end
