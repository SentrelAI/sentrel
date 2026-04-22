require "rails_helper"

RSpec.describe PublicIdSerialization do
  let(:org) { create_org }
  let(:agent) { with_tenant(org) { create_agent(org) } }

  describe "as_json" do
    it "swaps User#id for to_param (prefix_id) in the output" do
      user = create_user(org)
      hash = user.as_json(only: [:id, :name])
      expect(hash["id"]).to eq(user.to_param)
      expect(hash["id"]).to start_with("usr_")
      expect(hash["name"]).to eq(user.name)
    end

    it "swaps Agent#id for to_param" do
      hash = agent.as_json(only: [:id, :name, :slug])
      expect(hash["id"]).to eq(agent.to_param)
      expect(hash["id"]).to start_with("agt_")
    end

    it "swaps Task#id for to_param" do
      user = create_user(org)
      task = with_tenant(org) do
        Task.create!(organization: org, agent: agent, assigned_by_user: user, title: "t", status: "todo", priority: "normal")
      end
      hash = task.as_json(only: [:id, :title])
      expect(hash["id"]).to eq(task.to_param)
      expect(hash["id"]).to start_with("tsk_")
    end

    it "is a no-op when id is not in the selected columns" do
      hash = agent.as_json(only: [:name, :slug])
      expect(hash.keys).to match_array(["name", "slug"])
    end

    it "preserves round-trip — find(to_param) resolves back to the same record" do
      user = create_user(org)
      hash = user.as_json
      roundtripped = User.find(hash["id"])
      expect(roundtripped.id).to eq(user.id)
    end
  end

  describe "prefix_id decoding" do
    it "Agent.find accepts prefix_id" do
      resolved = Agent.find(agent.to_param)
      expect(resolved.id).to eq(agent.id)
    end

    it "Agent.find still accepts numeric id (fallback: true)" do
      resolved = Agent.find(agent.id)
      expect(resolved.id).to eq(agent.id)
    end

    it "find_by_prefix_id works for tenanted models" do
      with_tenant(org) do
        resolved = Agent.find_by_prefix_id(agent.to_param)
        expect(resolved&.id).to eq(agent.id)
      end
    end
  end
end
