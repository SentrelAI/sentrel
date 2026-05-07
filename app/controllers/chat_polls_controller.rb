class ChatPollsController < ApplicationController
  before_action :authenticate_user!

  # GET /agents/:agent_id/chat/poll?after_id=message_id
  def show
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
    after_id = params[:after_id].to_i

    conversation = agent.conversations.find_by(kind: "internal", user: current_user)

    if conversation
      # Find assistant message with ID greater than the user's message ID
      latest = conversation.messages
        .where(role: "assistant")
        .where("id > ?", after_id)
        .order(id: :desc)
        .first

      if latest
        render json: {
          id: latest.id,
          content: latest.content,
          metadata: latest.metadata,
        }
        return
      end
    end

    render json: { content: nil }
  end
end
