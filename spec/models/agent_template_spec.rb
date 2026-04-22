require "rails_helper"

RSpec.describe AgentTemplate do
  describe "validations" do
    it "requires slug, name, role" do
      t = described_class.new
      expect(t).not_to be_valid
      expect(t.errors[:slug]).to include("can't be blank")
      expect(t.errors[:name]).to include("can't be blank")
      expect(t.errors[:role]).to include("can't be blank")
    end

    it "enforces slug uniqueness" do
      described_class.create!(slug: "x", name: "X", role: "X", identity_md: "hi")
      dup = described_class.new(slug: "x", name: "Y", role: "Y")
      expect(dup).not_to be_valid
      expect(dup.errors[:slug]).to include("has already been taken")
    end
  end

  describe "#render" do
    let(:t) do
      described_class.create!(
        slug: "t", name: "T", role: "Tester",
        identity_md: "I am {{agent_name}} at {{company_name}}, reporting to {{user_name}}.",
        personality_md: "Voice of {{agent_name}}.",
        instructions_md: "Do work for {{company_name}}.",
      )
    end

    it "substitutes agent_name, company_name, user_name" do
      out = t.render(agent_name: "Alex", company_name: "Acme", user_name: "Abdel")
      expect(out[:identity_md]).to eq("I am Alex at Acme, reporting to Abdel.")
      expect(out[:personality_md]).to eq("Voice of Alex.")
      expect(out[:instructions_md]).to eq("Do work for Acme.")
    end

    it "accepts string keys too" do
      out = t.render("agent_name" => "Alex", "company_name" => "Acme")
      expect(out[:identity_md]).to include("I am Alex at Acme")
    end

    it "falls back to the template name when agent_name is omitted" do
      out = t.render(company_name: "Acme")
      expect(out[:identity_md]).to include("I am T at Acme")
    end

    it "leaves unknown tokens empty rather than raising" do
      t.update!(identity_md: "Hi {{nonexistent}}.")
      expect(t.render[:identity_md]).to eq("Hi .")
    end

    it "is a no-op for blank fields" do
      t.update!(personality_md: nil)
      expect(t.render[:personality_md]).to be_nil
    end
  end

  describe "seeded templates" do
    before(:all) do
      load Rails.root.join("db/seeds/agent_templates.rb")
    end

    it "seeds the full template pack idempotently" do
      expect(AgentTemplate.count).to be >= 14
      %w[
        ceo marketing-lead compliance-officer proposal-writer
        engineer product-manager designer content-writer data-analyst finance
        sdr support researcher recruiter
      ].each do |slug|
        t = AgentTemplate.find_by(slug: slug)
        expect(t).to be_present, "expected template #{slug} to be seeded"
        expect(t.identity_md).to be_present
        expect(t.personality_md).to be_present
        expect(t.instructions_md).to be_present
      end
    end

    it "has migrated rfp-filler away" do
      expect(AgentTemplate.find_by(slug: "rfp-filler")).to be_nil
      expect(AgentTemplate.find_by(slug: "proposal-writer")).to be_present
    end
  end
end
