class ScheduledTasksController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  def index
    render json: @agent.scheduled_tasks.order(created_at: :desc).as_json(
      only: [:id, :name, :instruction, :cron_expression, :timezone, :active, :last_run_at, :next_run_at]
    )
  end

  def create
    task = @agent.scheduled_tasks.build(scheduled_task_params)
    task.organization = current_tenant

    if task.save
      render json: task.as_json(only: [:id, :name, :instruction, :cron_expression, :timezone, :active])
    else
      render json: { error: task.errors.full_messages.join(", ") }, status: :unprocessable_entity
    end
  end

  def update
    task = @agent.scheduled_tasks.find(params[:id])
    if task.update(scheduled_task_params)
      render json: task.as_json(only: [:id, :name, :instruction, :cron_expression, :timezone, :active])
    else
      render json: { error: task.errors.full_messages.join(", ") }, status: :unprocessable_entity
    end
  end

  def destroy
    task = @agent.scheduled_tasks.find(params[:id])
    task.destroy
    head :no_content
  end

  private

  def set_agent
    @agent = current_tenant.agents.find(params[:agent_id])
  end

  def scheduled_task_params
    params.require(:scheduled_task).permit(:name, :instruction, :cron_expression, :timezone, :active)
  end
end
