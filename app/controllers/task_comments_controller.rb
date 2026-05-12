class TaskCommentsController < ApplicationController
  before_action :authenticate_user!

  def create
    task = find_by_public_id!(current_tenant.tasks, params[:task_id])
    return redirect_back fallback_location: task_path(task), alert: "Task has no conversation yet" unless task.conversation_id

    message = task.conversation.messages.create!(
      role: "user",
      content: params[:content].to_s,
      direction: "inbound",
      channel: "task",
      sender_name: current_user.name,
      sender_email: current_user.email,
      sender_user_id: current_user.id,
      metadata: { task_id: task.id, source: "task_comment", user_id: current_user.id },
    )

    broadcast_comment(task, message)

    # Auto-reopen done/failed tasks when the user re-engages.
    if %w[done failed].include?(task.status)
      task.update!(status: "in_progress", completed_at: nil)
    end

    enqueue_task_followup(task, message) if task.status != "cancelled"
    redirect_to task_path(task), notice: "Comment added"
  end

  def destroy
    task = find_by_public_id!(current_tenant.tasks, params[:task_id])
    message = task.conversation&.messages&.find(params[:id])
    message&.destroy
    redirect_to task_path(task), notice: "Comment deleted"
  end

  private

  # Broadcast the comment to any open /tasks/:id tabs via ActionCable.
  def broadcast_comment(task, message)
    TaskChannel.broadcast_to(task, {
      id: message.to_param,
      content: message.content,
      created_at: message.created_at,
      author: current_user.as_json(only: [:id, :name]),
      author_type: "user",
    })
  rescue => e
    Rails.logger.warn "TaskChannel broadcast failed: #{e.message}"
  end

  def enqueue_task_followup(task, message)
    # Pull the full conversation history (skipping the seed) as the thread.
    thread = task.conversation.messages.order(id: :asc).drop(1).map do |m|
      author = m.role == "assistant" ? task.agent.name : (task.assigned_by_user&.name || "User")
      "[#{author}]: #{m.content}"
    end.join("\n\n")

    instruction = <<~INSTR.strip
      Follow-up on task: #{task.title}

      Original instruction: #{task.instruction || task.description}

      Comments thread:
      #{thread}

      The user just left a new comment. Read the full thread, take any actions they're asking for, then call comment_on_task with your response.
    INSTR

    AgentEventBus.publish(
      type: "task_assignment",
      agent: task.agent,
      conversation_id: task.conversation_id,
      # Idempotent on the message id — double-submit won't re-enqueue.
      job_id: "task-comment-#{message.id}",
      payload: {
        taskId: task.id,
        instruction: instruction,
      },
    )
  end
end
