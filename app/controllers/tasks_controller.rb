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
    # Comments now come from the task's conversation messages (the table
    # `task_comments` was dropped in favor of unified messages). Skip the
    # seed message (role=user, direction=inbound, channel=task) and render
    # the rest as comments for UI compatibility.
    comments = if @task.conversation
      @task.conversation.messages.order(id: :asc).drop(1).map do |m|
        {
          id: m.to_param,
          content: m.content,
          created_at: m.created_at,
          author: m.role == "assistant" ? @task.agent.as_json(only: [:id, :name]) : @task.assigned_by_user&.as_json(only: [:id, :name]),
          author_type: m.role == "assistant" ? "agent" : "user",
        }
      end
    else
      []
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
  #
  # Item 2 — propagates cancellation to descendants: any task with this one as
  # parent_task_id (set when create_task delegates to a sub-agent) is also
  # cancelled. One BFS pass covers any depth.
  def cancel
    @task = find_by_public_id!(current_tenant.tasks, params[:id])
    @task.update!(status: "cancelled")

    # BFS through parent_task_id descendants and cancel everything not already
    # in a terminal state. Track the agent_id on each cancelled task so we can
    # ping all affected engines below — an in-flight run that started before
    # the cancel needs the heads-up so it can short-circuit instead of
    # finishing the now-irrelevant work.
    cancelled_task_ids = [@task.id]
    affected_agent_ids = Set.new([@task.agent_id])
    frontier = [@task.id]
    while frontier.any?
      children = current_tenant.tasks
                                .where(parent_task_id: frontier)
                                .where.not(status: %w[done failed cancelled])
      break if children.empty?
      children.each { |c| affected_agent_ids << c.agent_id }
      cancelled_task_ids.concat(children.pluck(:id))
      children.update_all(status: "cancelled", updated_at: Time.current, completed_at: Time.current)
      frontier = children.pluck(:id)
    end
    cancelled_descendants = cancelled_task_ids.size - 1
    Rails.logger.info("Task #{@task.id} cancelled (#{cancelled_descendants} descendants)") if cancelled_descendants > 0

    # Item 2 — fire a task_cancelled inbox event to every affected agent so
    # in-flight runs can short-circuit. The engine treats this as a normal
    # inbox job; the next agent loop iteration sees status=cancelled in DB and
    # exits early.
    affected_agent_ids.each do |aid|
      agent = current_tenant.agents.find_by(id: aid)
      next unless agent
      AgentEventBus.publish(
        type: "task_cancelled",
        agent: agent,
        payload: { taskIds: cancelled_task_ids, rootTaskId: @task.id, reason: "user_cancel" },
      )
    end

    respond_to do |format|
      format.json { render json: task_json(@task) }
      format.html { redirect_to tasks_path, notice: "Task cancelled#{cancelled_descendants > 0 ? " (and #{cancelled_descendants} sub-task#{'s' if cancelled_descendants > 1})" : ''}" }
    end
  end

  private

  def set_task
    @task = find_by_public_id!(current_tenant.tasks, params[:id])
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
    # Pull the last 10 conversation turns (skipping the initial seed msg).
    recent_comments = if task.conversation
      msgs = task.conversation.messages.order(id: :asc).drop(1).last(10)
      msgs.map do |m|
        author = m.role == "assistant" ? task.agent.name : (task.assigned_by_user&.name || "User")
        "[#{author}]: #{m.content}"
      end.join("\n\n")
    else
      ""
    end

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
      # Idempotency: same job_id while the previous run is still in-flight
      # is a BullMQ no-op. Lets Rails retry safely; re-assignment after
      # completion still works because the previous job has drained.
      job_id: "task-assign-#{task.id}-resume-#{Time.current.to_i}",
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
      job_id: "task-assign-#{task.id}",
      payload: {
        taskId: task.id,
        instruction: "Task: #{task.title}\n\n#{task.description}\n\n#{task.instruction}".strip,
      },
    )
  end

  def task_json(task)
    # Full response lives in the conversation's last assistant message.
    # Comment count = total conversation messages minus the seed message.
    full_result = task.conversation&.messages&.where(role: "assistant")&.order(id: :desc)&.first&.content ||
                  task.result&.dig("response")
    comments_count = task.conversation ? [task.conversation.messages.count - 1, 0].max : 0

    task.as_json(only: [:id, :title, :description, :instruction, :status, :priority, :due_at, :started_at, :completed_at, :created_at]).merge(
      agent: task.agent.as_json(only: [:id, :name, :slug]),
      assigned_by: task.assigned_by_user&.as_json(only: [:id, :name]) || task.assigned_by_agent&.as_json(only: [:id, :name]),
      comments_count: comments_count,
      result: full_result,
    )
  end
end
