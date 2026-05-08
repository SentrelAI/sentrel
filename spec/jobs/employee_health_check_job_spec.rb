require "rails_helper"

RSpec.describe EmployeeHealthCheckJob, type: :job do
  let(:org) { create_org }
  let(:agent) { create_agent(org, status: "stopped") }
  let!(:instance) do
    agent.create_instance!(
      status: "stopped",
      provider: "fly",
      machine_id: "machine-1",
      machine_type: "shared-cpu-1x",
      provisioning_error: "Engine heartbeat stale: old",
    )
  end
  let(:redis) { instance_double(Redis) }

  before do
    allow(Redis).to receive(:new).and_return(redis)
  end

  it "marks an agent healthy from a fresh engine heartbeat" do
    timestamp_ms = (Time.current.to_f * 1000).to_i
    allow(redis).to receive(:get).with("health:#{agent.id}").and_return({ timestamp: timestamp_ms }.to_json)

    described_class.perform_now

    expect(agent.reload.status).to eq("running")
    expect(instance.reload.status).to eq("running")
    expect(instance.health_checked_at).to be_present
    expect(instance.provisioning_error).to be_nil
  end

  it "marks an agent unresponsive from a stale heartbeat" do
    agent.update!(status: "running")
    instance.update!(status: "running", provisioning_error: nil)
    timestamp_ms = (10.minutes.ago.to_f * 1000).to_i
    allow(redis).to receive(:get).with("health:#{agent.id}").and_return({ timestamp: timestamp_ms }.to_json)

    described_class.perform_now

    expect(agent.reload.status).to eq("stopped")
    expect(instance.reload.status).to eq("stopped")
    expect(instance.provisioning_error).to include("Engine heartbeat stale")
  end

  it "marks an agent unresponsive when no heartbeat exists" do
    agent.update!(status: "running")
    instance.update!(status: "running", provisioning_error: nil)
    allow(redis).to receive(:get).with("health:#{agent.id}").and_return(nil)

    described_class.perform_now

    expect(agent.reload.status).to eq("stopped")
    expect(instance.reload.status).to eq("stopped")
    expect(instance.provisioning_error).to include("No engine heartbeat found")
  end
end
