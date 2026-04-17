# Step 6 — engine→Rails bridge for real-time task comment broadcasts.
# When the engine saves a message to a task's conversation, it POSTs here
# so we can broadcast via ActionCable. Same auth pattern as api/blobs.
class Api::TaskEventsController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  before_action :authenticate_engine!

  # POST /api/task_events
  # Body: { task_id: N, message_id: N }
  def create
    task = Task.find_by(id: params[:task_id])
    return head :not_found unless task

    message = task.conversation&.messages&.find_by(id: params[:message_id])

    comment_data = if message
      {
        id: message.id,
        content: message.content,
        created_at: message.created_at,
        author: { id: nil, name: task.agent&.name || "Agent" },
        author_type: message.role == "assistant" ? "agent" : "user",
      }
    else
      # Fallback: broadcast the event even if message not found (yet)
      {
        id: params[:message_id],
        content: params[:content] || "",
        created_at: Time.current,
        author: { id: nil, name: "Agent" },
        author_type: "agent",
      }
    end

    TaskChannel.broadcast_to(task, comment_data)
    head :ok
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
