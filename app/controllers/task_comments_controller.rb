class TaskCommentsController < ApplicationController
  before_action :authenticate_user!

  def create
    task = current_tenant.tasks.find(params[:task_id])
    comment = task.comments.build(content: params[:content], user: current_user)

    if comment.save
      # Step 4 — dual-write: the task's conversation mirrors the comment as a
      # Message row so the engine can walk conversation history naturally and
      # session resume works for back-and-forth comment threads. During the
      # 1-week rollout window we keep writing to task_comments too; after
      # that it becomes the sole source of truth.
      mirror_comment_as_message(task, comment)
      broadcast_comment(task, comment)
      # If the task is closed, auto-reopen — the user clearly wants to
      # re-engage by commenting. Cancelled tasks stay cancelled (explicit user intent).
      if %w[done failed].include?(task.status)
        task.update!(status: "in_progress", completed_at: nil)
      end
      # Trigger agent run on any open task (todo/in_progress/awaiting_input).
      # Cancelled tasks don't re-engage — user must manually reopen first.
      if task.status != "cancelled"
        enqueue_task_followup(task, comment)
      end
      redirect_to task_path(task), notice: "Comment added"
    else
      redirect_back fallback_location: task_path(task), alert: comment.errors.full_messages.join(", ")
    end
  end

  private

  def mirror_comment_as_message(task, comment)
    return unless task.conversation_id # skip for tasks created before Step 4 backfill

    task.conversation.messages.create!(
      role: "user",
      content: comment.content,
      direction: "inbound",
      channel: "task",
      metadata: {
        task_id: task.id,
        task_comment_id: comment.id,
        source: "task_comment",
      },
    )
  rescue => e
    Rails.logger.error "TaskCommentsController: failed to mirror comment #{comment.id} to conversation: #{e.message}"
  end

  # Step 6 — broadcast via ActionCable so other open browsers see the comment instantly.
  def broadcast_comment(task, comment)
    TaskChannel.broadcast_to(task, {
      id: comment.id,
      content: comment.content,
      created_at: comment.created_at,
      author: (comment.user || comment.agent)&.as_json(only: [:id, :name]),
      author_type: comment.user_id ? "user" : "agent",
    })
  rescue => e
    Rails.logger.warn "TaskChannel broadcast failed: #{e.message}"
  end

  def enqueue_task_followup(task, comment)
    recent_comments = task.comments.includes(:user, :agent).order(created_at: :asc).map do |c|
      author = c.user&.name || c.agent&.name || "Unknown"
      "[#{author}]: #{c.content}"
    end.join("\n\n")

    instruction = <<~INSTR.strip
      Follow-up on task: #{task.title}

      Original instruction: #{task.instruction || task.description}

      Comments thread:
      #{recent_comments}

      The user just left a new comment. Read the full thread, take any actions they're asking for, then call comment_on_task with your response.
    INSTR

    AgentEventBus.publish(
      type: "task_assignment",
      agent: task.agent,
      conversation_id: task.conversation_id,
      payload: {
        taskId: task.id,
        instruction: instruction,
      },
    )
  end

  def destroy
    task = current_tenant.tasks.find(params[:task_id])
    comment = task.comments.find(params[:id])
    comment.destroy
    redirect_to task_path(task), notice: "Comment deleted"
  end
end
