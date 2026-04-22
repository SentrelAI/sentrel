class ScheduledTasksController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # Step 5 — reads from scheduled_work (unified table).
  # Backward compat: still accepts scheduled_task params for the form;
  # creates cron-mode scheduled_work rows.

  def index
    render json: @agent.scheduled_work.order(created_at: :desc).map { |sw| work_json(sw) }
  end

  def create
    sw = @agent.scheduled_work.build(work_create_params)
    sw.organization = current_tenant
    sw.mode = "cron" # UI creates only cron for now; once/interval come from agent tools

    if sw.save
      render json: work_json(sw)
    else
      render json: { error: sw.errors.full_messages.join(", ") }, status: :unprocessable_entity
    end
  end

  def update
    sw = find_by_public_id!(@agent.scheduled_work, params[:id])
    if sw.update(work_update_params)
      render json: work_json(sw)
    else
      render json: { error: sw.errors.full_messages.join(", ") }, status: :unprocessable_entity
    end
  end

  def destroy
    sw = find_by_public_id!(@agent.scheduled_work, params[:id])
    sw.destroy
    head :no_content
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  def work_create_params
    params.require(:scheduled_task).permit(:name, :instruction, :cron_expression, :timezone, :active, payload_extra: [:channel])
  end

  def work_update_params
    params.require(:scheduled_task).permit(:name, :instruction, :cron_expression, :timezone, :active, payload_extra: [:channel])
  end

  # Shape matches what the frontend expects — adds mode badge.
  def work_json(sw)
    {
      id: sw.to_param,
      name: sw.name,
      instruction: sw.instruction,
      cron_expression: sw.cron_expression,
      timezone: sw.timezone,
      active: sw.active,
      last_run_at: sw.last_run_at,
      next_run_at: sw.next_run_at,
      mode: sw.mode,
      fire_at: sw.fire_at,
      interval_seconds: sw.interval_seconds,
      delivery_channel: sw.payload_extra&.dig("channel"),
    }
  end
end
