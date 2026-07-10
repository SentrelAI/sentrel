require "rails_helper"

RSpec.describe AgentTemplates::UpstreamProposer do
  let(:org)   { create_org(name: "Northwind Health", email_domain: "northwind.test") }
  let(:user)  { create_user(org, name: "Dana Reyes", email: "dana@northwind.test") }
  let(:agent) { create_agent(org, name: "Rio", template_slug: "scheduler", template_version_number: 4) }

  let(:revision) do
    agent.persona_revisions.create!(
      organization: org, user: user, field: "instructions_md",
      before_text: "old", after_text: "I schedule for Dana Reyes at Northwind Health. Contact dana@northwind.test."
    )
  end

  subject(:proposer) { described_class.new(revision: revision, user: user) }

  describe "#detokenize" do
    it "re-tokenizes org/user/agent values, longest first" do
      out = proposer.send(:detokenize, revision.after_text)
      expect(out).to eq("I schedule for {{user_name}} at {{company_name}}. Contact {{user_email}}.")
    end

    it "leaves text without identifiable values untouched" do
      expect(proposer.send(:detokenize, "Always confirm the timezone.")).to eq("Always confirm the timezone.")
    end
  end

  describe "#parse_source" do
    it "parses tree URLs into owner/repo/ref/dir" do
      expect(proposer.send(:parse_source, "https://github.com/SentrelAI/agent-templates/tree/main/scheduler"))
        .to eq([ "SentrelAI", "agent-templates", "main", "scheduler" ])
    end

    it "defaults to main for bare repo URLs" do
      expect(proposer.send(:parse_source, "https://github.com/SentrelAI/agent-templates"))
        .to eq([ "SentrelAI", "agent-templates", "main", nil ])
    end
  end

  describe "#call guards" do
    it "raises without the GitHub token" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("GITHUB_TEMPLATES_TOKEN").and_return(nil)
      expect { proposer.call }.to raise_error(described_class::Error, /token not configured/)
    end

    it "raises when the agent has no template lineage" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("GITHUB_TEMPLATES_TOKEN").and_return("tok")
      agent.update_columns(template_slug: nil)
      expect { proposer.call }.to raise_error(described_class::Error, /isn't linked to a template/)
    end
  end
end
