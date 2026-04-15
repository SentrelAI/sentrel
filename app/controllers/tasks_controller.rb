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

    render inertia: "tasks/show", props: {
      task: task_json(@task),
      comments: comments,
    }
  end

  def create
    task = current_tenant.tasks.build(task_params)
    task.assigned_by_user = current_user

    if task.save
      redirect_to tasks_path, notice: "Task created"
    else
      redirect_back fallback_location: tasks_path, alert: task.errors.full_messages.join(", ")
    end
  end

  def update
    if @task.update(task_params)
      if request.format.json? || request.content_type&.include?("json")
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

  private

  def set_task
    @task = current_tenant.tasks.find(params[:id])
  end

  def task_params
    params.require(:task).permit(:agent_id, :title, :description, :instruction, :status, :priority, :due_at)
  end

  def task_json(task)
    task.as_json(only: [:id, :title, :description, :instruction, :status, :priority, :due_at, :started_at, :completed_at, :created_at]).merge(
      agent: task.agent.as_json(only: [:id, :name, :slug]),
      assigned_by: task.assigned_by_user&.as_json(only: [:id, :name]) || task.assigned_by_agent&.as_json(only: [:id, :name]),
      comments_count: task.comments.count,
    )
  end
end
