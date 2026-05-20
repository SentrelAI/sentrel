require "rails_helper"

RSpec.describe Forge::QualityLint do
  describe ".template" do
    let(:good_template) do
      double("template",
             identity_md: <<~MD,
               I am {{agent_name}}, the test agent.

               I report to {{user_name}}.

               My job is to validate that QualityLint passes good copy.
               I care about: correctness, brevity, voice.
               I don't care about: marketing fluff.

               When I find ambiguity I ask before guessing.
             MD
             personality_md: <<~MD,
               I am direct.

               I don't use jargon.

               I say "I don't know" when I don't know.

               I ship.
             MD
             instructions_md: <<~MD,
               # How I work

               ## Delegation
               - I assign tasks via create_task.

               ## Prioritization
               - I close one loop before opening the next.

               ## Escalation
               - I brief {{user_name}} when stuck.
             MD
             email_signature_md: "— {{agent_name}}\nSpec Agent · {{company_name}}",
             name: "Test Agent")
    end

    it "passes a high-quality template" do
      result = described_class.template(good_template)
      expect(result.pass).to be true
      expect(result.score).to be >= 70
    end

    it "fails templates with banned phrases" do
      bad_template = double("template",
                            identity_md: "I am leveraging synergy to drive value.\n" * 7,
                            personality_md: good_template.personality_md,
                            instructions_md: good_template.instructions_md,
                            email_signature_md: good_template.email_signature_md,
                            name: "Test Agent")
      result = described_class.template(bad_template)
      expect(result.pass).to be false
      expect(result.warnings.map { |w| w[:rule] }).to include(:buzzwords)
    end

    it "fails templates missing the email signature" do
      no_sig = double("template",
                      identity_md: good_template.identity_md,
                      personality_md: good_template.personality_md,
                      instructions_md: good_template.instructions_md,
                      email_signature_md: nil,
                      name: "Test Agent")
      result = described_class.template(no_sig)
      expect(result.warnings.map { |w| w[:rule] }).to include(:missing_signature)
    end

    it "fails templates whose identity isn't first-person" do
      third_person = double("template",
                            identity_md: "Sarah leads the sales team.\nSarah reports to the CEO.\nSarah closes deals.\nSarah meets quota every quarter.\nSarah hates filler words.\nSarah is direct.\n",
                            personality_md: good_template.personality_md,
                            instructions_md: good_template.instructions_md,
                            email_signature_md: good_template.email_signature_md,
                            name: "Sarah")
      result = described_class.template(third_person)
      expect(result.warnings.map { |w| w[:rule] }).to include(:not_first_person).or include(:third_person_drift)
    end
  end

  describe ".skill" do
    it "passes a well-structured skill" do
      sections = ["When to Use", "When NOT to Use", "Auth", "Endpoints", "Workflow", "Errors", "Rules"]
      body = sections.map { |s| "## #{s}\n- bullet\n" }.join("\n") + ("\nfiller line." * 50)
      good_skill = double("skill", skill_md: body)
      result = described_class.skill(good_skill)
      expect(result.pass).to be true
    end

    it "fails skills missing the canonical sections" do
      bad_skill = double("skill", skill_md: "# Skill\n" + ("body line.\n" * 60))
      result = described_class.skill(bad_skill)
      expect(result.warnings.map { |w| w[:rule] }).to include(:missing_sections)
    end
  end
end
