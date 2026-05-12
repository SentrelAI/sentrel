class AgentTemplatesController < ApplicationController
  before_action :authenticate_user!

  # GET /agent_templates           — Inertia browse page
  # GET /agent_templates.json      — JSON for the new-agent picker (legacy)
  def index
    scope = AgentTemplate.visible_to(current_tenant).order(:category, :name)

    respond_to do |format|
      format.json { render json: scope.map { |t| template_json(t) } }
      format.html do
        templates = scope.map { |t| template_json(t).merge(
          install_count: t.install_count,
          published: t.published,
          system_template: t.system_template,
          author_name: author_name_for(t),
          owned_by_me: t.created_by_user_id == current_user.id,
        ) }
        render inertia: "templates/index", props: {
          templates: templates,
          categories: AgentTemplate::CATEGORIES,
        }
      end
    end
  end

  # GET /agent_templates/:id  (slug)
  def show
    template = AgentTemplate.visible_to(current_tenant).find_by!(slug: params[:id])
    respond_to do |format|
      format.json {
        render json: template_json(template).merge(
          identity_md: template.identity_md,
          personality_md: template.personality_md,
          instructions_md: template.instructions_md,
        )
      }
      format.html {
        render inertia: "templates/show", props: {
          template: template_json(template).merge(
            identity_md: template.identity_md,
            personality_md: template.personality_md,
            instructions_md: template.instructions_md,
            install_count: template.install_count,
            published: template.published,
            system_template: template.system_template,
            author_name: author_name_for(template),
            owned_by_me: template.created_by_user_id == current_user.id,
          ),
        }
      }
    end
  end

  # POST /agent_templates  — "Save as template" snapshots an agent into a new
  # community template. Owner = current user; org = current tenant.
  def create
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])

    template = AgentTemplate.snapshot_from(
      agent,
      user: current_user,
      name: params[:name].to_s.presence || "#{agent.name} (saved)",
      category: params[:category],
      description: params[:description],
      published: ActiveModel::Type::Boolean.new.cast(params[:published]),
    )

    redirect_to agent_template_path(template.slug), notice: "Template “#{template.name}” saved"
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: agent_path(agent), alert: e.message
  end

  # PATCH /agent_templates/:id — toggle published, rename, recategorize. Only
  # the template's owner (or system admins) may mutate it.
  def update
    template = AgentTemplate.find_by!(slug: params[:id])
    forbid_mutation_for_non_owner!(template)

    if template.update(template_params)
      redirect_to agent_template_path(template.slug), notice: "Template updated"
    else
      redirect_back fallback_location: agent_template_path(template.slug), alert: template.errors.full_messages.join(", ")
    end
  end

  # DELETE /agent_templates/:id — owner-only.
  def destroy
    template = AgentTemplate.find_by!(slug: params[:id])
    forbid_mutation_for_non_owner!(template)
    template.destroy
    redirect_to agent_templates_path, notice: "Template removed"
  end

  private

  def template_params
    params.require(:template).permit(:name, :description, :category, :published)
  end

  def author_name_for(t)
    return "Alchemy" if t.system_template
    t.created_by_user&.name.presence || "Workspace member"
  end

  def forbid_mutation_for_non_owner!(t)
    return if t.created_by_user_id == current_user.id
    redirect_to agent_template_path(t.slug), alert: "You can only edit templates you created" and return
  end

  def template_json(t)
    {
      slug: t.slug,
      name: t.name,
      role: t.role,
      description: t.description,
      icon: t.icon,
      category: t.category,
      capabilities: t.capabilities,
      suggested_skill_slugs: t.suggested_skill_slugs,
      suggested_manager_role: t.suggested_manager_role,
      suggested_provider: t.suggested_provider,
      suggested_model: t.suggested_model,
      variables: t.variables,
    }
  end
end
