class SkillsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_skill, only: [:show, :edit, :update, :destroy, :publish, :unpublish, :fork]

  # GET /skills — browse (own org + published marketplace seeds + a system tab)
  def index
    scope = SkillDefinition.visible_to(current_tenant).order(:category, :name)
    scope = scope.where(category: params[:category]) if params[:category].present?
    if params[:q].present?
      q = "%#{params[:q].downcase}%"
      scope = scope.where("LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(slug) LIKE ?", q, q, q)
    end

    skills = scope.includes(:created_by_user).map { |s| skill_card_json(s) }

    render inertia: "skills/index", props: {
      skills: skills,
      categories: SkillDefinition.visible_to(current_tenant).distinct.pluck(:category).compact.sort,
      filters: { category: params[:category], q: params[:q], visibility: params[:visibility] },
    }
  end

  # GET /skills/new — wizard step that lands the user into the editor
  def new
    render inertia: "skills/new", props: {
      categories: %w[common sales support marketing engineering finance content writing ops generic],
    }
  end

  # POST /skills — create + redirect into the editor.
  def create
    attrs = skill_params.to_h
    @skill = SkillDefinition.new(
      slug: SkillDefinition.unique_slug(attrs["slug"].presence || attrs["name"]),
      name: attrs["name"],
      description: attrs["description"],
      category: attrs["category"].presence || "generic",
      icon: attrs["icon"],
      source: "user_made",
      organization_id: current_tenant.id,
      created_by_user_id: current_user.id,
      visibility: "private",
      published: false,
      version: 1,
      install_count: 0,
      required_capabilities: [],
      required_integrations: [],
      requires_connections: [],
      skill_md: "# #{attrs['name']}\n\n#{attrs['description']}\n\n## When to use\n\nDescribe when this skill applies.\n\n## How to use it\n\nStep-by-step instructions for the agent.\n",
    )

    if @skill.save
      # Every fresh skill gets a SKILL.md seed so the editor isn't empty.
      @skill.skill_files.create!(path: "SKILL.md", content: @skill.skill_md, file_type: "md", position: 0)
      redirect_to edit_skill_path(@skill.slug), notice: "Skill created — open the editor to flesh it out"
    else
      redirect_back fallback_location: skills_path, alert: @skill.errors.full_messages.join(", ")
    end
  end

  # GET /skills/:slug — read-only detail (preview + install button).
  def show
    files = @skill.skill_files.ordered.map { |f| { id: f.id, path: f.path, content: f.content, file_type: f.file_type } }
    render inertia: "skills/show", props: {
      skill: skill_full_json(@skill).merge(files: files),
      can_edit: @skill.editable_by?(current_user),
    }
  end

  # GET /skills/:slug/edit — multi-file editor
  def edit
    forbid_unless_editor!
    files = @skill.skill_files.ordered.map { |f| { id: f.id, path: f.path, content: f.content, file_type: f.file_type, position: f.position } }
    render inertia: "skills/edit", props: {
      skill: skill_full_json(@skill).merge(files: files),
    }
  end

  # PATCH /skills/:slug — bulk save: metadata + files (create / update / delete)
  def update
    forbid_unless_editor!
    attrs = skill_params.to_h
    file_changes = (params[:files] || []).map { |f| f.respond_to?(:to_unsafe_h) ? f.to_unsafe_h : f.to_h }

    SkillDefinition.transaction do
      @skill.update!(attrs.slice("name", "description", "category", "icon", "visibility").compact)
      apply_file_changes!(@skill, file_changes)
      @skill.sync_legacy_skill_md!
    end

    # Engines for agents that have this skill installed need to re-fetch.
    EngineSync.trigger_for_skill(@skill) if defined?(EngineSync.trigger_for_skill)

    render json: { ok: true, version: @skill.reload.version, updated_at: @skill.updated_at }
  rescue ActiveRecord::RecordInvalid => e
    render json: { ok: false, error: e.message }, status: :unprocessable_entity
  end

  # DELETE /skills/:slug — owner only.
  def destroy
    forbid_unless_editor!
    # Capture agent IDs BEFORE destroy — the FK cascade on agent_skills
    # wipes the join rows so we'd lose the fan-out target after the fact.
    dependent_agent_ids = AgentSkill.where(skill_definition_id: @skill.id).distinct.pluck(:agent_id)
    @skill.destroy!
    dependent_agent_ids.each do |agent_id|
      agent = Agent.find_by(id: agent_id)
      EngineSync.trigger(agent) if agent
    end
    redirect_to skills_path, notice: "Skill removed"
  end

  # POST /skills/:slug/publish — flips published true, bumps version.
  def publish
    forbid_unless_editor!
    @skill.publish!
    redirect_back fallback_location: skill_path(@skill.slug), notice: "Published v#{@skill.version}"
  end

  # POST /skills/:slug/unpublish — pulls the skill from marketplace view.
  def unpublish
    forbid_unless_editor!
    @skill.unpublish!
    redirect_back fallback_location: skill_path(@skill.slug), notice: "Unpublished"
  end

  # POST /skills/:slug/fork — copy a marketplace skill into your org so you
  # can customize it without affecting the original.
  def fork
    forked = @skill.fork_to(user: current_user, organization: current_tenant, name: params[:name])
    redirect_to edit_skill_path(forked.slug), notice: "Forked “#{@skill.name}” — open the editor to customize"
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: skill_path(@skill.slug), alert: e.message
  end

  private

  def load_skill
    @skill = SkillDefinition.visible_to(current_tenant).find_by!(slug: params[:id])
  end

  def forbid_unless_editor!
    return if @skill.editable_by?(current_user)
    redirect_to skill_path(@skill.slug), alert: "You can only edit skills your workspace owns"
  end

  def skill_params
    params.require(:skill).permit(:name, :slug, :description, :category, :icon, :visibility)
  end

  # Diff-apply file changes from the editor. Each entry has shape:
  #   { id?, path, content, _delete? }
  # No id → create. id + _delete=true → destroy. id without _delete → update.
  def apply_file_changes!(skill, changes)
    return if changes.blank?
    seen_ids = []
    changes.each_with_index do |change, idx|
      id = change["id"].presence
      if change["_delete"] && id.present?
        skill.skill_files.where(id: id).destroy_all
        next
      end
      attrs = {
        path: change["path"].to_s.strip,
        content: change["content"].to_s,
        position: change["position"] || idx,
      }
      if id.present?
        rec = skill.skill_files.find(id)
        rec.update!(attrs)
        seen_ids << rec.id
      else
        rec = skill.skill_files.create!(attrs)
        seen_ids << rec.id
      end
    end
  end

  def skill_card_json(s)
    {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      category: s.category,
      icon: s.icon,
      source: s.source,
      visibility: s.visibility,
      published: s.published,
      version: s.version,
      install_count: s.install_count,
      organization_id: s.organization_id,
      owned_by_me: s.organization_id == current_tenant&.id,
      created_by: s.created_by_user&.name,
      updated_at: s.updated_at,
    }
  end

  def skill_full_json(s)
    skill_card_json(s).merge(
      required_capabilities: s.required_capabilities,
      required_integrations: s.required_integrations,
      requires_connections:  s.requires_connections,
      system_prompt_fragment: s.system_prompt_fragment,
      skill_md: s.skill_md,
    )
  end
end
