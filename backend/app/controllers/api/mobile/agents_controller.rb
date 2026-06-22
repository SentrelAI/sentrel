class Api::Mobile::AgentsController < Api::Mobile::BaseController
  before_action :load_agent, only: [ :show, :update, :destroy ]

  # GET /api/mobile/agents
  def index
    agents = current_tenant.agents.includes(:ai_config, :instance, :manager).order(:name)
    render json: { agents: agents.map { |a| agent_summary(a) } }
  end

  # GET /api/mobile/agents/:id
  def show
    render json: { agent: agent_json(@agent), spend: spend_payload(@agent) }
  end

  # POST /api/mobile/agents  { agent: {...}, ai_config: {...} }
  # Direct ("blank") create — the robust path that doesn't depend on a
  # template. Mirrors AgentsController#create's blank branch.
  def create
    @agent = current_tenant.agents.build(agent_params)
    @agent.save!

    ai_cfg = ai_config_params
    ai_cfg[:provider] = "anthropic_account" if ai_cfg[:provider].to_s == "anthropic" && org_has_anthropic_oauth?
    @agent.create_ai_config!(ai_cfg) if ai_cfg.any?

    install_skill_slugs!(@agent, params[:skill_slugs])

    EngineSync.trigger(@agent) if defined?(EngineSync)
    ProvisionAgentJob.perform_later(@agent.id) if defined?(ProvisionAgentJob)

    render json: { agent: agent_json(@agent) }, status: :created
  end

  # PATCH /api/mobile/agents/:id
  def update
    env_before = engine_env_signature(@agent)
    @agent.update!(agent_params)

    if (cfg = ai_config_params).any?
      @agent.ai_config ? @agent.ai_config.update!(cfg) : @agent.create_ai_config!(cfg)
    end

    # Push fresh env to the running machine when something the engine reads
    # changed — same trigger the web update action uses.
    if defined?(AgentMachineOps) && env_before != engine_env_signature(@agent.reload)
      AgentMachineOps.reload(@agent) rescue nil
    end

    render json: { agent: agent_json(@agent) }
  end

  # DELETE /api/mobile/agents/:id
  def destroy
    @agent.destroy
    head :no_content
  end

  private

  def load_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:id])
  end

  def agent_params
    permitted = params.require(:agent).permit(
      :name, :slug, :role, :status, :manager_id,
      :identity_md, :personality_md, :instructions_md, :email_signature_md, :memory_md,
      :spend_daily_cap_usd, :spend_monthly_cap_usd, :spend_notify_threshold_pct,
      :heartbeat_enabled, :heartbeat_interval_minutes, :approval_mode
    ).to_h

    # capabilities/permissions are free-form jsonb the engine reads; accept the
    # same nested shape the web form sends. Values are bounded by the model, so
    # permit! on these two sub-hashes is safe here.
    if (caps = params[:agent][:capabilities]).present?
      permitted[:capabilities] = caps.respond_to?(:permit!) ? caps.permit!.to_h : caps
    end
    if (perms = params[:agent][:permissions]).present?
      permitted[:permissions] = perms.respond_to?(:permit!) ? perms.permit!.to_h : perms
    end
    permitted
  end

  def ai_config_params
    params.fetch(:ai_config, {}).permit(:provider, :model_id, :temperature, :max_tokens, :thinking_level).to_h
  end

  def install_skill_slugs!(agent, slugs)
    Array(slugs).map(&:to_s).reject(&:blank?).uniq.each do |slug|
      skill = SkillDefinition.where(slug: slug)
        .where("organization_id = ? OR organization_id IS NULL", current_tenant.id)
        .first
      agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true) if skill
    end
  end

  def org_has_anthropic_oauth?
    return false unless current_tenant.respond_to?(:anthropic_oauth_connected?)
    current_tenant.anthropic_oauth_connected?
  rescue
    false
  end

  # Coarse fingerprint of the agent fields the engine consumes — if it changes
  # on update we trigger a machine reload.
  def engine_env_signature(agent)
    [
      agent.slug, agent.role, agent.identity_md, agent.personality_md,
      agent.instructions_md, agent.permissions, agent.capabilities,
      agent.ai_config&.provider, agent.ai_config&.model_id
    ].map(&:to_s).join("|")
  end

  def agent_summary(agent)
    {
      id: agent.to_param,
      name: agent.name,
      slug: agent.slug,
      role: agent.role,
      status: agent.status,
      model_id: agent.ai_config&.model_id,
      instance_status: agent.instance&.status
    }
  end

  def agent_json(agent)
    agent.as_json(only: [
      :name, :slug, :role, :status,
      :identity_md, :personality_md, :instructions_md, :memory_md, :email_signature_md,
      :spend_daily_cap_usd, :spend_monthly_cap_usd, :spend_notify_threshold_pct,
      :heartbeat_enabled, :heartbeat_interval_minutes, :permissions, :approval_mode,
      :created_at, :updated_at
    ]).merge(
      "id" => agent.to_param,
      "capabilities" => agent.try(:effective_capabilities) || agent.capabilities,
      "ai_config" => agent.ai_config&.as_json(only: [ :provider, :model_id, :temperature, :max_tokens, :thinking_level ]),
      "instance" => agent.instance&.as_json(only: [ :status, :region, :provider, :machine_id, :public_ip, :health_checked_at, :started_at, :provisioning_error ]),
      "manager" => agent.manager&.as_json(only: [ :id, :name, :slug ])&.merge("id" => agent.manager&.to_param)
    )
  end

  def spend_payload(agent)
    spend = AgentSpend.for_agent(agent)
    {
      today_usd: spend[:today][:cost_usd],
      seven_day_usd: spend[:seven_day][:cost_usd],
      thirty_day_usd: spend[:thirty_day][:cost_usd],
      daily_cap_usd: agent.spend_daily_cap_usd&.to_f,
      monthly_cap_usd: agent.spend_monthly_cap_usd&.to_f,
      runs_today: spend[:today][:runs],
      top_models: spend[:thirty_day][:top_models]
    }
  end
end
