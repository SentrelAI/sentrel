require "rails_helper"

RSpec.describe AgentTemplates::Installer do
  let(:org)  { create_org }
  let(:user) { create_user(org) }

  let(:definition) do
    {
      "spec_version" => "1.1",
      "kind"         => "agent",
      "name"         => "Nova",
      "role"         => "Marketer",
      "persona"      => {
        "identity_md" => "I market {{brand_name}} for {{company_name}}."
      },
      "model"        => { "provider" => "anthropic", "model_id" => "claude-opus-4-8" },
      "inputs"       => [
        { "key" => "brand_name", "label" => "Brand", "required" => true },
        { "key" => "timezone", "label" => "Timezone", "default" => "UTC" }
      ],
      "schedules"    => [
        {
          "name"        => "Daily pass",
          "cron"        => "0 9 * * 1-5",
          "timezone"    => "{{timezone}}",
          "instruction" => "Run the daily pass for {{brand_name}}."
        }
      ]
    }
  end

  def install(inputs: {})
    described_class.new(
      definition: definition,
      agent_attrs: { name: "Nova", slug: "nova-#{SecureRandom.hex(3)}" },
      user: user,
      organization: org,
      inputs: inputs,
    ).call
  end

  it "substitutes deploy-time inputs into the persona" do
    agent = install(inputs: { "brand_name" => "Acme" })
    expect(agent.identity_md).to include("I market Acme for #{org.name}.")
  end

  it "creates the definition's schedules with inputs interpolated" do
    agent = install(inputs: { "brand_name" => "Acme", "timezone" => "America/New_York" })
    sched = agent.scheduled_work.find_by!(name: "Daily pass")
    expect(sched.instruction).to eq("Run the daily pass for Acme.")
    expect(sched.timezone).to eq("America/New_York")
    expect(sched.cron_expression).to eq("0 9 * * 1-5")
    expect(sched.active).to be(true)
  end

  it "falls back to UTC for unresolved or invalid timezones" do
    definition["inputs"] = [ { "key" => "brand_name", "label" => "Brand" } ]
    agent = install(inputs: { "brand_name" => "Acme" })
    expect(agent.scheduled_work.find_by!(name: "Daily pass").timezone).to eq("UTC")

    definition["schedules"][0]["timezone"] = "Not/AZone"
    agent2 = install(inputs: { "brand_name" => "Acme" })
    expect(agent2.scheduled_work.find_by!(name: "Daily pass").timezone).to eq("UTC")
  end

  it "uses input defaults when the caller omits a value" do
    agent = install(inputs: { "brand_name" => "Acme" })
    expect(agent.scheduled_work.find_by!(name: "Daily pass").timezone).to eq("UTC")
  end

  it "installs without schedules or inputs (legacy definitions)" do
    definition.delete("schedules")
    definition.delete("inputs")
    agent = install
    expect(agent).to be_persisted
    expect(agent.scheduled_work.count).to eq(0)
  end
end
