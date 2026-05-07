class ChatPollsController < ApplicationController
  before_action :authenticate_user!

  # GET /agents/:agent_id/chat/poll?after=ISO8601_timestamp
  # Returns the most recent assistant message strictly after `after`, if any.
  # We compare on created_at rather than id because Message uses PrefixedIds
  # (msg_…) — to_i on the prefixed string would always be 0.
  def show
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
    raw_after = params[:after].presence || params[:after_id].presence
    after_time = parse_time(raw_after) || Time.at(0)

    conversation = agent.conversations.find_by(kind: "internal", user: current_user)

    if conversation
      latest = conversation.messages
        .where(role: "assistant")
        .where("created_at > ?", after_time)
        .order(created_at: :desc)
        .first

      if latest && latest.content.to_s.strip.length > 0
        render json: {
          id: latest.id,
          content: latest.content,
          metadata: latest.metadata,
          created_at: latest.created_at.iso8601,
        }
        return
      end
    end

    render json: { content: nil }
  end

  private

  def parse_time(raw)
    return nil if raw.blank?
    Time.parse(raw)
  rescue ArgumentError, TypeError
    nil
  end
end
