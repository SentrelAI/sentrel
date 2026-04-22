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

  # GET /agents/tree(.json)
  # Full nested org chart for the current tenant. Roots = agents with no
  # manager; children = each agent's direct reports. Used by the agents index
  # "tree" view and the engine's teammate roster.
  def tree
    agents = current_tenant.agents.includes(:ai_config).order(:name)
    by_manager = agents.group_by(&:manager_id)

    build = ->(agent) {
      {
        id: agent.to_param,
        name: agent.name,
        slug: agent.slug,
        role: agent.role,
        status: agent.status,
        model_id: agent.ai_config&.model_id,
        reports: (by_manager[agent.id] || []).map { |child| build.call(child) },
      }
    }

    roots = (by_manager[nil] || []).map { |a| build.call(a) }
    render json: { roots: roots, total: agents.size }
  end

  def show
    # Find internal chat conversation (boss ↔ agent). Multiple internal convs
    # exist for historical reasons — pick the most recently active one, and
    # prefer the one tied to this specific user.
    chat_conversation = @agent.conversations
      .where(kind: "internal", user: current_user)
      .order(updated_at: :desc)
      .first
    chat_messages = chat_conversation ? chat_conversation.messages.order(id: :asc).as_json(
      only: [:id, :role, :content, :channel, :metadata, :created_at]
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
      # Individual email messages for mail-style inbox
      emails: Message.joins(:conversation)
        .where(conversations: { agent_id: @agent.id, kind: "external" })
        .where(channel: "email")
        .order(created_at: :desc)
        .limit(50)
        .map { |m|
          m.as_json(only: [:id, :role, :content, :direction, :channel, :created_at]).merge(
            subject: m.metadata&.dig("subject"),
            to: m.metadata&.dig("to"),
            from: m.direction == "inbound" ? m.conversation.contact_email : @agent.channel_configs.find_by(channel_type: "email")&.config&.dig("address"),
            conversation_id: m.conversation_id,
            contact: m.conversation.contact_email || m.conversation.contact_name,
          )
        },
      chat_messages: chat_messages,
      approvals_by_message: approvals_by_message,
      tasks: @agent.tasks.order(created_at: :desc).limit(20).as_json(
        only: [:id, :title, :status, :priority, :due_at, :completed_at]
      ),
      channel_configs: @agent.channel_configs.as_json(only: [:id, :channel_type, :enabled, :status]),
      scheduled_tasks: @agent.scheduled_work.order(created_at: :desc).map { |sw|
        recent_logs = AuditLog.where(agent_id: @agent.id, action: "scheduled_task")
          .where("input->>'taskId' = ?", sw.id.to_s)
          .order(created_at: :desc).limit(20)
          .map { |l| {
            id: l.to_param,
            status: l.status,
            output: l.output&.dig("response"),
            duration_ms: l.output&.dig("duration_ms"),
            tool_calls: l.output&.dig("tool_calls") || [],
            created_at: l.created_at,
          } }

        {
          id: sw.to_param,
          name: sw.name,
          instruction: sw.instruction,
          cron_expression: sw.cron_expression,
          timezone: sw.timezone,
          active: sw.active,
          last_run_at: sw.last_run_at,
          mode: sw.mode,
          fire_at: sw.fire_at,
          interval_seconds: sw.interval_seconds,
          recent_runs: recent_logs,
        }
      },
      knowledge_documents: fetch_knowledge_documents(@agent),
      # Sprint 6 — skills
      installed_skills: @agent.agent_skills.includes(:skill_definition).map { |as|
        as.skill_definition.as_json(only: [:id, :slug, :name, :description, :category, :icon, :requires_connections])
          .merge(enabled: as.enabled, agent_skill_id: as.id)
      },
      available_skills: SkillDefinition.where.not(
        id: @agent.agent_skills.select(:skill_definition_id)
      ).order(:category, :name).as_json(
        only: [:id, :slug, :name, :description, :category, :icon, :requires_connections]
      )
    }
  end

  def new
    render inertia: "agents/new", props: {
      templates: AgentTemplate.order(:name).map { |t| template_summary(t) },
      agents: current_tenant.agents.select(:id, :name, :slug, :role).order(:name).map { |a|
        { id: a.to_param, name: a.name, slug: a.slug, role: a.role }
      },
    }
  end

  def create
    template = params[:template_slug].present? ? AgentTemplate.find_by(slug: params[:template_slug]) : nil

    @agent = current_tenant.agents.build(agent_params)

    if template
      rendered = template.render(
        agent_name: @agent.name,
        company_name: current_tenant.name,
        user_name: current_user.name,
        role: @agent.role.presence || template.role,
      )
      @agent.identity_md     ||= rendered[:identity_md]
      @agent.personality_md  ||= rendered[:personality_md]
      @agent.instructions_md ||= rendered[:instructions_md]
      @agent.role = template.role if @agent.role.blank?
      @agent.capabilities = template.capabilities.deep_merge(@agent.capabilities || {})
    end

    if @agent.save
      @agent.create_ai_config!(ai_config_params)

      # Install the template's suggested skills (if any).
      if template && template.suggested_skill_slugs.any?
        defs = SkillDefinition.where(slug: template.suggested_skill_slugs)
        defs.each { |d| @agent.agent_skills.find_or_create_by!(skill_definition: d).update!(enabled: true) }
      end

      EngineSync.trigger(@agent)
      redirect_to agent_path(@agent), notice: "Agent created"
    else
      redirect_back fallback_location: new_agent_path, alert: @agent.errors.full_messages.join(", ")
    end
  end

  def edit
    render inertia: "agents/edit", props: {
      agent: agent_json(@agent),
      agents: current_tenant.agents.where.not(id: @agent.id).select(:id, :name, :slug, :role).order(:name).map { |a|
        { id: a.to_param, name: a.name, slug: a.slug, role: a.role }
      },
    }
  end

  def update
    if @agent.update(agent_params)
      @agent.ai_config&.update(ai_config_params) if params[:ai_config].present?
      EngineSync.trigger(@agent)
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
    @agent = find_by_public_id!(current_tenant.agents, params[:id])
  end

  # Fetches the agent's knowledge_base docs from the engine. Best-effort —
  # returns [] if the engine is unreachable so the page still renders.
  def fetch_knowledge_documents(agent)
    require "net/http"
    base = ENV.fetch("ENGINE_URL", "http://localhost:3300")
    uri = URI.parse("#{base}/rag/documents?agent_id=#{agent.id}")
    req = Net::HTTP::Get.new(uri)
    req["X-Engine-Secret"] = ENV["ENGINE_API_SECRET"] || ""
    res = Net::HTTP.start(uri.hostname, uri.port, read_timeout: 3, open_timeout: 1) { |http| http.request(req) }
    return [] unless res.is_a?(Net::HTTPSuccess)
    JSON.parse(res.body)["documents"] || []
  rescue => e
    Rails.logger.warn "fetch_knowledge_documents failed for agent #{agent.id}: #{e.message}"
    []
  end

  CAPABILITY_KEYS = {
    knowledge_base: [:enabled, :always_retrieve, :threshold, :top_k],
    scheduling:   [:enabled],
    tasks:        [:enabled],
    integrations: [:enabled],
    recall:       [:enabled],
    send_media:   [:enabled]
  }.freeze

  def agent_params
    permitted = params.require(:agent).permit(
      :name, :slug, :role, :status, :manager_id,
      :identity_md, :personality_md, :instructions_md, :email_signature_md, :memory_md,
      :heartbeat_enabled, :heartbeat_interval_minutes, :approval_mode,
      permissions: {},
      capabilities: CAPABILITY_KEYS
    )
    # Frontend posts manager_id as a prefix_id string (e.g. "agt_..."); decode
    # to the numeric FK. "none" / blank clears the manager.
    if permitted.key?(:manager_id)
      raw = permitted[:manager_id]
      permitted[:manager_id] =
        if raw.blank? || raw == "none"
          nil
        elsif raw.is_a?(String) && raw.start_with?("agt_")
          Agent._prefix_id.decode(raw)
        else
          raw
        end
    end
    permitted
  end

  # Lightweight template summary for the new-agent picker UI.
  def template_summary(t)
    {
      slug: t.slug,
      name: t.name,
      role: t.role,
      description: t.description,
      icon: t.icon,
      capabilities: t.capabilities,
      suggested_skill_slugs: t.suggested_skill_slugs,
      suggested_manager_role: t.suggested_manager_role,
      variables: t.variables,
    }
  end

  def ai_config_params
    params.fetch(:ai_config, {}).permit(:provider, :model_id, :temperature, :max_tokens, :thinking_level)
  end

  def agent_json(agent)
    agent.as_json(only: [
      :id, :name, :slug, :role, :status,
      :identity_md, :personality_md, :instructions_md, :memory_md, :email_signature_md,
      :heartbeat_enabled, :heartbeat_interval_minutes, :permissions, :approval_mode,
      :created_at, :updated_at
    ]).merge(
      capabilities: agent.effective_capabilities,
      ai_config: agent.ai_config&.as_json(only: [:provider, :model_id, :temperature, :max_tokens, :thinking_level]),
      instance: agent.instance&.as_json(only: [:status, :instance_type, :region, :aws_ip_address]),
      manager: agent.manager&.as_json(only: [:id, :name, :slug])
    )
  end
end
