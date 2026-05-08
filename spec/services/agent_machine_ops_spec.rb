require "rails_helper"

RSpec.describe AgentMachineOps do
  let(:org) { create_org }
  let(:agent) { create_agent(org) }

  def create_instance(attrs = {})
    agent.create_instance!({
      status: "running",
      provider: "fly",
      machine_id: "old-mid",
      machine_type: "shared-cpu-1x",
    }.merge(attrs))
  end

  describe ".redeploy" do
    it "recreates the machine when Fly no longer has the recorded machine id" do
      instance = create_instance
      app = described_class.app_name(agent)

      allow(described_class)
        .to receive(:fly_api)
        .with(:get, "/apps/#{app}/machines/old-mid")
        .and_raise(described_class::ApiNotFound)

      allow(AgentProvisioner).to receive(:provision_for) do |provisioned_agent|
        provisioned_agent.instance.update!(
          status: "running",
          machine_id: "new-mid",
          public_ip: "fdaa::1",
          provisioning_error: nil,
        )
        provisioned_agent.instance
      end

      result = described_class.redeploy(agent)

      expect(result).to include(ok: true)
      expect(result[:message]).to include("recreated machine new-mid")
      expect(instance.reload.machine_id).to eq("new-mid")
      expect(AgentProvisioner).to have_received(:provision_for).with(agent)
    end
  end

  describe ".restart" do
    it "records operation failures on the instance" do
      instance = create_instance
      app = described_class.app_name(agent)

      allow(described_class)
        .to receive(:fly_api)
        .with(:post, "/apps/#{app}/machines/old-mid/restart")
        .and_raise(StandardError, "Fly timeout")

      result = described_class.restart(agent)

      expect(result).to include(ok: false, operation: "restart", message: "Fly timeout", error_class: "StandardError")
      expect(instance.reload.provisioning_error).to include("Ops restart failed")
      expect(instance.provisioning_error).to include("Fly timeout")
    end

    it "returns a structured failure when no machine id is recorded" do
      instance = create_instance(machine_id: nil)

      result = described_class.restart(agent)

      expect(result).to include(ok: false, operation: "restart", message: "Agent has no machine_id recorded")
      expect(instance.reload.provisioning_error).to include("Agent has no machine_id recorded")
    end
  end

  describe ".reprovision" do
    it "destroys the has_one instance record and enqueues provisioning" do
      create_instance
      allow(AgentProvisioner).to receive(:terminate_for)
      allow(ProvisionAgentJob).to receive(:perform_later)

      result = described_class.reprovision(agent)

      expect(result).to include(ok: true)
      expect(agent.reload.instance).to be_nil
      expect(ProvisionAgentJob).to have_received(:perform_later).with(agent.id)
    end
  end
end
