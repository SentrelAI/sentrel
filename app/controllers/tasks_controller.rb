class TasksController < ApplicationController
  before_action :authenticate_user!
  before_action :set_task, only: [:show, :update, :destroy]

  def index
    render inertia: "tasks/index", props: {
      tasks: current_tenant.tasks.includes(:agent, :assigned_by_user, :assigned_by_agent)
        .order(created_at: :desc).map { |t| task_json(t) },
      agents: current_tenant.agents.select(:id, :name, :slug).as_json(only: [:id, :name, :slug])
    }
  end

  def show
    comments = @task.comments.includes(:agent, :user).order(created_at: :asc).map do |c|
      {
        id: c.id,
        content: c.content,
        created_at: c.created_at,
        author: c.user&.as_json(only: [:id, :name]) || c.agent&.as_json(only: [:id, :name]),
        author_type: c.user_id ? "user" : "agent",
      }
    end

    respond_to do |format|
      format.json { render json: { task: task_json(@task), comments: comments } }
      format.html { render inertia: "tasks/show", props: { task: task_json(@task), comments: comments } }
    end
  end

  def create
    task = current_tenant.tasks.build(task_params)
    task.assigned_by_user = current_user

    Task.transaction do
      if task.save
        # Step 4 — each task gets its own conversation (chat thread). The
        # initial instruction is seeded as the first user message so the
        # agent's prompt-builder can walk conversation history naturally on
        # resume, and back-and-forth comments get prompt-cache hits.
        task.update!(conversation: build_task_conversation(task))
      end
    end

    if task.persisted?
      enqueue_task_assignment(task)
      redirect_to tasks_path, notice: "Task created"
    else
      redirect_back fallback_location: tasks_path, alert: task.errors.full_messages.join(", ")
    end
  end

  def update
    prev_status = @task.status

    if @task.update(task_params)
      # If user moved task BACK to todo/in_progress from done/failed, ask agent for a status update
      new_status = @task.status
      if %w[done failed].include?(prev_status) && %w[todo in_progress].include?(new_status)
        @task.update(completed_at: nil) if prev_status == "done"
        enqueue_status_check(@task)
      end

      if request.headers["X-Inertia"]
        redirect_to tasks_path, notice: "Task updated"
      elsif request.format.json? || request.content_type&.include?("json")
        render json: task_json(@task)
      else
        redirect_to tasks_path, notice: "Task updated"
      end
    else
      redirect_back fallback_location: tasks_path, alert: @task.errors.full_messages.join(", ")
    end
  end

  def destroy
    @task.destroy
    redirect_to tasks_path, notice: "Task deleted"
  end

  # Step 5.5 — user-initiated cancel. Sets status; any in-flight agent run
  # keeps running to completion (engine-side interrupt comes in a follow-up).
  # Idempotent: cancelling an already-cancelled task is a no-op.
  def cancel
    @task = current_tenant.tasks.find(params[:id])
    @task.update!(status: "cancelled")
    respond_to do |format|
      format.json { render json: task_json(@task) }
      format.html { redirect_to tasks_path, notice: "Task cancelled" }
    end
  end

  private

  def set_task
    @task = current_tenant.tasks.find(params[:id])
  end

  def task_params
    params.require(:task).permit(:agent_id, :title, :description, :instruction, :status, :priority, :due_at)
  end

  # Create a conversation for the task and seed the first user message with
  # the task instruction — mirrors how inbound channel messages look to the
  # engine, so the agent doesn't need a special task_assignment code path in
  # prompt-builder once Step 4 ships everywhere.
  def build_task_conversation(task)
    conv = current_tenant.conversations.create!(
      agent: task.agent,
      kind: "internal",
      user: current_user,
      contact_identifier: "task-#{task.id}",
      contact_name: current_user.name,
      contact_email: current_user.email,
      subject: task.title,
      status: "active",
    )
    seed = ["Task: #{task.title}", task.description, task.instruction].compact_blank.join("\n\n")
    conv.messages.create!(
      role: "user",
      content: seed,
      direction: "inbound",
      channel: "task",
      metadata: { task_id: task.id, source: "task_created" },
    )
    conv
  end

  def enqueue_status_check(task)
    recent_comments = task.comments.includes(:user, :agent).order(created_at: :asc).last(10).map do |c|
      author = c.user&.name || c.agent&.name || "Unknown"
      "[#{author}]: #{c.content}"
    end.join("\n\n")

    instruction = <<~INSTR.strip
      Task was reopened: #{task.title}

      The user moved this task from "#{task.status_was || "done"}" back to "#{task.status}".

      Original description: #{task.description}
      Original instruction: #{task.instruction}

      Recent comments thread:
      #{recent_comments}

      This usually means the user wants you to:
      - Review the current status
      - Identify what else needs to be done
      - Continue working OR ask clarifying questions

      Post a comment via comment_on_task with:
      1. Current status of what's been done
      2. What you think is still needed
      3. Any clarifying questions

      Do NOT mark the task as done automatically — wait for the user's guidance.
    INSTR

    AgentEventBus.publish(
      type: "task_assignment",
      agent: task.agent,
      conversation_id: task.conversation_id,
      payload: {
        taskId: task.id,
        instruction: instruction,
        skipAutoComplete: true,
      },
    )
  end

  def enqueue_task_assignment(task)
    AgentEventBus.publish(
      type: "task_assignment",
      agent: task.agent,
      conversation_id: task.conversation_id,
      payload: {
        taskId: task.id,
        instruction: "Task: #{task.title}\n\n#{task.description}\n\n#{task.instruction}".strip,
      },
    )
  end

  def task_json(task)
    # Full response lives in the conversation's last assistant message (Step 4).
    # Fall back to task.result for tasks created before the migration.
    full_result = task.conversation&.messages&.where(role: "assistant")&.order(id: :desc)&.first&.content ||
                  task.result&.dig("response")

    task.as_json(only: [:id, :title, :description, :instruction, :status, :priority, :due_at, :started_at, :completed_at, :created_at]).merge(
      agent: task.agent.as_json(only: [:id, :name, :slug]),
      assigned_by: task.assigned_by_user&.as_json(only: [:id, :name]) || task.assigned_by_agent&.as_json(only: [:id, :name]),
      comments_count: task.comments.count,
      result: full_result,
    )
  end
end
