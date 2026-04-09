class AgentsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent, only: [:show, :edit, :update, :destroy]

  def index
    render inertia: "agents/index", props: {
      agents: current_tenant.agents.includes(:ai_config, :instance, :manager).map { |a|
        agent_json(a)
      }
    }
  end

  def show
    # Find internal chat conversation (boss ↔ agent)
    chat_conversation = @agent.conversations.find_by(kind: "internal", user: current_user)
    chat_messages = chat_conversation ? chat_conversation.messages.order(id: :asc).as_json(
      only: [:id, :role, :content, :channel, :created_at]
    ) : []

    # Get approvals keyed by message_id for inline rendering
    approvals_by_message = @agent.pending_approvals
      .where.not(message_id: nil)
      .where("created_at > ?", 7.days.ago)
      .group_by(&:message_id)
      .transform_values { |approvals|
        approvals.map { |a| a.as_json(only: [:id, :tool_name, :tool_input, :status, :created_at]) }
      }

    render inertia: "agents/show", props: {
      agent: agent_json(@agent),
      conversations: @agent.conversations.where(kind: "external").includes(:messages).order(updated_at: :desc).limit(20).map { |c|
        last_msg = c.messages.order(created_at: :desc).first
        c.as_json(only: [:id, :kind, :contact_name, :contact_email, :contact_phone, :subject, :status, :updated_at]).merge(
          channel: last_msg&.channel,
          message_count: c.messages.count,
          last_message_preview: last_msg&.content&.truncate(80),
          last_message_direction: last_msg&.direction,
        )
      },
      chat_messages: chat_messages,
      approvals_by_message: approvals_by_message,
      tasks: @agent.tasks.order(created_at: :desc).limit(20).as_json(
        only: [:id, :title, :status, :priority, :due_at, :completed_at]
      ),
      channel_configs: @agent.channel_configs.as_json(only: [:id, :channel_type, :enabled, :status]),
      scheduled_tasks: @agent.scheduled_tasks.as_json(
        only: [:id, :name, :cron_expression, :active, :last_run_at]
      )
    }
  end

  def new
    render inertia: "agents/new"
  end

  def create
    @agent = current_tenant.agents.build(agent_params)

    if @agent.save
      @agent.create_ai_config!(ai_config_params)
      redirect_to agent_path(@agent), notice: "Agent created"
    else
      redirect_back fallback_location: new_agent_path, alert: @agent.errors.full_messages.join(", ")
    end
  end

  def edit
    render inertia: "agents/edit", props: {
      agent: agent_json(@agent)
    }
  end

  def update
    if @agent.update(agent_params)
      @agent.ai_config&.update(ai_config_params) if params[:ai_config].present?
      redirect_to agent_path(@agent), notice: "Agent updated"
    else
      redirect_back fallback_location: edit_agent_path(@agent), alert: @agent.errors.full_messages.join(", ")
    end
  end

  def destroy
    @agent.destroy
    redirect_to agents_path, notice: "Agent deleted"
  end

  private

  def set_agent
    @agent = current_tenant.agents.find(params[:id])
  end

  def agent_params
    params.require(:agent).permit(
      :name, :slug, :role, :status, :manager_id,
      :identity_md, :personality_md, :instructions_md,
      :heartbeat_enabled, :heartbeat_interval_minutes,
      permissions: {}
    )
  end

  def ai_config_params
    params.fetch(:ai_config, {}).permit(:provider, :model_id, :temperature, :max_tokens, :thinking_level)
  end

  def agent_json(agent)
    agent.as_json(only: [
      :id, :name, :slug, :role, :status,
      :identity_md, :personality_md, :instructions_md, :memory_md,
      :heartbeat_enabled, :heartbeat_interval_minutes, :permissions,
      :created_at, :updated_at
    ]).merge(
      ai_config: agent.ai_config&.as_json(only: [:provider, :model_id, :temperature, :max_tokens, :thinking_level]),
      instance: agent.instance&.as_json(only: [:status, :instance_type, :region, :aws_ip_address]),
      manager: agent.manager&.as_json(only: [:id, :name, :slug])
    )
  end
end
