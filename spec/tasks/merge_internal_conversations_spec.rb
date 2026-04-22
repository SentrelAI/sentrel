require "rails_helper"
require "rake"

RSpec.describe "merge:internal_conversations" do
  before(:all) do
    Rails.application.load_tasks if Rake::Task.tasks.none? { |t| t.name == "merge:internal_conversations" }
  end

  let(:org) { create_org }
  let(:user) { create_user(org) }
  let(:agent) { with_tenant(org) { create_agent(org) } }

  def create_internal(agent, user, updated_at: Time.current, msgs: 0)
    conv = nil
    with_tenant(agent.organization) do
      conv = Conversation.create!(
        organization: agent.organization,
        agent: agent,
        user: user,
        kind: "internal",
        contact_identifier: "u#{user.id}-c#{SecureRandom.hex(4)}",
        status: "active",
      )
      conv.update_columns(updated_at: updated_at)
      msgs.times { |i| conv.messages.create!(role: "user", content: "msg #{i}", direction: "inbound") }
    end
    conv
  end

  def run_task(mode = nil)
    task = Rake::Task["merge:internal_conversations"]
    task.reenable
    if mode
      task.invoke(mode)
    else
      task.invoke
    end
  end

  it "keeps the most recently-updated conversation and reparents messages from losers" do
    winner = create_internal(agent, user, updated_at: 1.hour.ago,  msgs: 5)
    loser1 = create_internal(agent, user, updated_at: 2.days.ago,  msgs: 3)
    loser2 = create_internal(agent, user, updated_at: 7.days.ago,  msgs: 2)

    expect { run_task }.to output(/Merged 1\/1 group/).to_stdout

    expect(Conversation.where(id: [loser1.id, loser2.id]).count).to eq(0)
    expect(Conversation.find(winner.id).messages.count).to eq(10)
  end

  it "dry mode makes no changes" do
    create_internal(agent, user, updated_at: 1.hour.ago)
    create_internal(agent, user, updated_at: 2.days.ago)
    before_count = Conversation.where(agent_id: agent.id).count

    expect { run_task("dry") }.to output(/DRY RUN/).to_stdout

    expect(Conversation.where(agent_id: agent.id).count).to eq(before_count)
  end

  it "skips rows with nil user_id (out of scope for this merger)" do
    ghost = nil
    with_tenant(org) do
      ghost = Conversation.create!(
        organization: org, agent: agent, user_id: nil,
        kind: "internal", contact_identifier: "ghost-#{SecureRandom.hex(4)}",
        status: "active",
      )
    end
    # A second conv for the same user=nil would still be ignored
    expect { run_task }.not_to change { Conversation.exists?(ghost.id) }
  end

  it "does nothing when no duplicates exist" do
    create_internal(agent, user, msgs: 1)
    expect { run_task }.to output(/No duplicate/).to_stdout
  end
end
