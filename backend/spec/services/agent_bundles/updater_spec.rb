require "rails_helper"

RSpec.describe AgentBundles::Updater do
  let(:org) { create_org }
  let(:user) { create_user(org) }

  # Minimal valid bundle; tweak the parts a redeploy should pick up.
  def build_manifest(instructions: "Do the thing.", skill_md: nil, cron: "0 9 * * 1-5", model: nil)
    yaml = {
      "spec" => "agent-bundle/v1",
      "name" => "Scheduler",
      "role" => "Scheduling Assistant",
      "schedules" => [
        { "name" => "Morning sweep", "cron" => cron, "instruction" => "Sweep the calendar." }
      ]
    }
    yaml["model"] = model if model
    yaml["skills"] = [ "skills/follow-up" ] if skill_md
    files = {
      "agent.yaml" => yaml.to_yaml,
      "identity.md" => "I am {{agent_name}}.",
      "personality.md" => "Crisp.",
      "instructions.md" => instructions
    }
    files["skills/follow-up/SKILL.md"] = skill_md if skill_md
    AgentBundles::Manifest.parse!(files)
  end

  def deploy!(manifest)
    AgentBundles::Deployer.new(manifest: manifest, user: user, organization: org).call.agent
  end

  def update!(agent, manifest)
    described_class.new(manifest: manifest, agent: agent, user: user, organization: org).call
  end

  it "replaces spec-owned state and keeps operator-owned state" do
    agent = deploy!(build_manifest(instructions: "v1 instructions."))
    bundle_schedule = agent.scheduled_work.find_by!(name: "Morning sweep")

    # Operator customizations a redeploy must not clobber.
    agent.update!(name: "Custom Name", memory_md: "remembered things")
    bundle_schedule.update!(active: false)
    own_schedule = with_tenant(org) do
      agent.scheduled_work.create!(
        organization: org, mode: "cron", name: "My own job",
        instruction: "Custom", cron_expression: "0 12 * * *", timezone: "UTC", active: true,
      )
    end

    update!(agent, build_manifest(instructions: "v2 instructions.", cron: "30 8 * * 1-5"))
    agent.reload

    expect(agent.instructions_md).to include("v2 instructions.")
    expect(agent.name).to eq("Custom Name")
    expect(agent.memory_md).to eq("remembered things")
    expect(agent.identity_md).to eq("I am Custom Name.")

    bundle_schedule.reload
    expect(bundle_schedule.cron_expression).to eq("30 8 * * 1-5")
    expect(bundle_schedule.active).to be(false) # operator's toggle survives
    expect(own_schedule.reload.cron_expression).to eq("0 12 * * *")
    expect(agent.scheduled_work.count).to eq(2) # no duplicates created
  end

  it "updates org-owned imported skill content in place" do
    v1_md = "---\nname: Follow-up\n---\nv1 protocol"
    agent = deploy!(build_manifest(skill_md: v1_md))
    skill = agent.skill_definitions.find_by!(slug: "follow-up")

    update!(agent, build_manifest(skill_md: "---\nname: Follow-up\n---\nv2 protocol"))

    expect(agent.reload.skill_definitions.count).to eq(1)
    expect(skill.reload.skill_md).to include("v2 protocol")
    expect(skill.skill_files.find_by!(path: "SKILL.md").content).to include("v2 protocol")
  end

  it "forks instead of mutating a skill the org doesn't own" do
    platform_skill = SkillDefinition.create!(
      organization_id: nil, slug: "follow-up", name: "Follow-up", category: "common",
      source: "built_in", visibility: "marketplace", published: true, skill_md: "platform content",
    )
    agent = create_agent(org)
    with_tenant(org) { agent.agent_skills.create!(skill_definition: platform_skill, enabled: true) }

    update!(agent, build_manifest(skill_md: "---\nname: Follow-up\n---\nbundle content"))

    expect(platform_skill.reload.skill_md).to eq("platform content")
    linked = agent.reload.skill_definitions
    expect(linked.count).to eq(1)
    expect(linked.first.slug).to start_with("follow-up-imported-")
    expect(linked.first.skill_md).to include("bundle content")
  end

  it "leaves the operator's model pick alone when the bundle declares none" do
    agent = deploy!(build_manifest)
    agent.ai_config.update!(model_id: "claude-opus-4-8")

    update!(agent, build_manifest(instructions: "v2"))

    expect(agent.reload.ai_config.model_id).to eq("claude-opus-4-8")
  end

  it "applies the bundle's model when declared" do
    agent = deploy!(build_manifest)

    update!(agent, build_manifest(model: { "provider" => "anthropic", "id" => "claude-fable-5" }))

    expect(agent.reload.ai_config.model_id).to eq("claude-fable-5")
  end
end
