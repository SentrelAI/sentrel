class AgentTemplatesController < ApplicationController
  before_action :authenticate_user!

  # GET /agent_templates           — Inertia browse page
  # GET /agent_templates.json      — JSON for the new-agent picker (legacy)
  #
  # acts_as_tenant on AgentTemplate stacks its default_scope on top of
  # `visible_to`, filtering out organization_id: NULL rows (system seeds)
  # even though visible_to explicitly includes them. Wrap in
  # without_tenant so visible_to does the actual access check itself
  # (which already permits "NULL OR current org").
  def index
    # Capture current_tenant outside the block — inside without_tenant
    # the helper returns nil, which would hide org-owned templates from
    # the org's own users.
    tenant = current_tenant
    scope = ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant).order(:category, :name).to_a
    end

    respond_to do |format|
      format.json { render json: scope.map { |t| template_json(t) } }
      format.html do
        templates = scope.map { |t| template_json(t).merge(
          install_count: t.install_count,
          published: t.published,
          system_template: t.system_template,
          author_name: author_name_for(t),
          owned_by_me: t.created_by_user_id == current_user.id,
          license: t.license,
          current_version_number: t.current_version&.version_number,
        ) }
        render inertia: "templates/index", props: {
          templates: templates,
          categories: AgentTemplate::CATEGORIES
        }
      end
    end
  end

  # GET /agent_templates/:id  (slug)  [?version=N]
  # Optional ?version= picks a specific historical version's definition;
  # defaults to template.current_version. Renders both a metadata payload
  # the show page uses for its rendered tab AND the raw definition for
  # the JSON tab.
  def show
    tenant = current_tenant
    template = ActsAsTenant.without_tenant do
      AgentTemplate.includes(:versions).visible_to(tenant).find_by!(slug: params[:id])
    end
    version = pick_version(template, params[:version])
    definition = version&.definition || legacy_definition_from(template)

    respond_to do |format|
      format.json {
        render json: template_json(template).merge(
          identity_md: template.identity_md,
          personality_md: template.personality_md,
          instructions_md: template.instructions_md,
          definition: definition,
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
            license: template.license,
          ),
          definition: definition,
          current_version: version_summary(version),
          versions: template.versions.map { |v| version_summary(v) }.compact
        }
      }
    end
  end

  # POST /agent_templates — "Publish to community" for the first time.
  # Routes through AgentTemplates::Publisher so v1 is created immediately
  # with the embedded skill bundles + capability config + approval rules —
  # not the legacy flat snapshot. (Re-publish on an existing template goes
  # through #publish below.)
  def create
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])

    template = AgentTemplates::Publisher.new(
      agent: agent,
      user: current_user,
      name: params[:name].to_s.presence || "#{agent.name} (saved)",
      category: params[:category],
      description: params[:description],
      license: params[:license],
      changelog: params[:changelog].presence || "Initial publish",
    ).call

    redirect_to agent_template_path(template.slug), notice: "Published “#{template.name}” v#{template.current_version&.version_number || 1}"
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: agent_path(agent), alert: e.message
  end

  # POST /agent_templates/:id/publish
  # Body: { agent_id, name?, category?, description?, license?, changelog? }
  # Re-publishes an existing template — creates a new immutable version
  # from a (possibly updated) source agent. Owner-only.
  def publish
    template = ActsAsTenant.without_tenant { AgentTemplate.find_by!(slug: params[:id]) }
    forbid_mutation_for_non_owner!(template)
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])

    AgentTemplates::Publisher.new(
      agent: agent,
      template: template,
      user: current_user,
      name: params[:name].presence || template.name,
      category: params[:category].presence || template.category,
      description: params[:description].presence || template.description,
      license: params[:license].presence || template.license,
      changelog: params[:changelog],
    ).call

    redirect_to agent_template_path(template.slug), notice: "Published v#{template.reload.current_version.version_number}"
  rescue ActiveRecord::RecordInvalid => e
    redirect_back fallback_location: agent_template_path(template.slug), alert: e.message
  end

  # GET /agent_templates/import — renders the Inertia import form.
  # The form posts back to #import with one of {definition, json, url}.
  def new_import
    render inertia: "templates/import", props: {
      supported_spec_versions: AgentTemplates::Importer::SUPPORTED_SPEC_VERSIONS
    }
  end

  # POST /agent_templates/import
  # Body: either { definition: <hash> } or { json: <string> } or { url: <https://...> }
  # Validates spec_version, creates AgentTemplate + v1.
  def import
    definition = resolve_definition!
    template = AgentTemplates::Importer.new(
      definition,
      user: current_user,
      organization: current_tenant,
    ).call
    redirect_to agent_template_path(template.slug), notice: "Imported as “#{template.name}”"
  rescue AgentTemplates::Importer::UnsupportedSpec,
         AgentTemplates::Importer::InvalidDefinition => e
    redirect_back fallback_location: agent_templates_path, alert: "Import failed: #{e.message}"
  rescue => e
    Rails.logger.warn "[AgentTemplates#import] #{e.class}: #{e.message}"
    redirect_back fallback_location: agent_templates_path, alert: "Import failed: #{e.message}"
  end

  # GET /agent_templates/:id/export
  # Returns the current version's definition as a downloadable agent.json.
  def export
    tenant = current_tenant
    template = ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant).find_by!(slug: params[:id])
    end
    version = template.current_version
    definition = version&.definition || legacy_definition_from(template)
    send_data JSON.pretty_generate(definition),
              filename: "#{template.slug}.agent.json",
              type: "application/json",
              disposition: "attachment"
  end

  # PATCH /agent_templates/:id — toggle published, rename, recategorize. Only
  # the template's owner (or system admins) may mutate it.
  def update
    template = ActsAsTenant.without_tenant { AgentTemplate.find_by!(slug: params[:id]) }
    return if forbid_system_template!(template)
    forbid_mutation_for_non_owner!(template)

    if template.update(template_params)
      redirect_to agent_template_path(template.slug), notice: "Template updated"
    else
      redirect_back fallback_location: agent_template_path(template.slug), alert: template.errors.full_messages.join(", ")
    end
  end

  # DELETE /agent_templates/:id — owner-only.
  def destroy
    template = ActsAsTenant.without_tenant { AgentTemplate.find_by!(slug: params[:id]) }
    return if forbid_system_template!(template)
    forbid_mutation_for_non_owner!(template)
    template.destroy
    redirect_to agent_templates_path, notice: "Template removed"
  end

  private

  def template_params
    params.require(:template).permit(:name, :description, :category, :published, :license)
  end

  def author_name_for(t)
    return "Sentrel" if t.system_template
    t.created_by_user&.name.presence || "Workspace member"
  end

  def forbid_mutation_for_non_owner!(t)
    return if t.created_by_user_id == current_user.id
    redirect_to agent_template_path(t.slug), alert: "You can only edit templates you created" and return
  end

  # Official (bundle-derived) templates are managed from their GitHub bundle —
  # the repo is the source of truth, so they can't be edited/removed in-app.
  # Returns true (and redirects) when the mutation should be blocked.
  def forbid_system_template!(t)
    return false unless t.system_template
    redirect_to agent_template_path(t.slug),
                alert: "This is an official template — edit its bundle on GitHub, not here."
    true
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
      variables: t.variables
    }
  end

  def pick_version(template, requested)
    if requested.present? && requested.to_s != "current"
      template.versions.find_by(version_number: requested.to_i) || template.current_version
    else
      template.current_version
    end
  end

  def version_summary(version)
    return nil unless version
    {
      version_number: version.version_number,
      spec_version:   version.spec_version,
      license:        version.license,
      changelog:      version.changelog,
      created_at:     version.created_at,
      created_by:     version.created_by_user&.name
    }
  end

  # Fallback definition shape for legacy templates that haven't been
  # backfilled to v1 yet. Mirrors what the backfill rake task emits.
  def legacy_definition_from(t)
    {
      "spec_version" => "1.0",
      "kind"         => "agent",
      "name"         => t.name,
      "role"         => t.role,
      "description"  => t.description,
      "category"     => t.category,
      "icon"         => t.icon,
      "license"      => t.license,
      "persona" => {
        "identity_md"        => t.identity_md,
        "personality_md"     => t.personality_md,
        "instructions_md"    => t.instructions_md,
        "email_signature_md" => t.email_signature_md
      },
      "model" => {
        "provider" => t.suggested_provider,
        "model_id" => t.suggested_model
      }.compact,
      "capabilities" => t.capabilities || {},
      "skills"       => Array(t.suggested_skill_slugs).map { |s| { "slug" => s } },
      "integrations_required" => Array(t.suggested_integrations).map { |s| { "service" => s } },
      "approval_rules" => []
    }
  end

  # Parse the import payload. Three shapes supported:
  #   - definition: <Hash>   (already parsed by Inertia)
  #   - json: <String>       (raw paste)
  #   - url: <https://…>     (server-side fetch, 1MB cap, HTTPS only)
  def resolve_definition!
    if params[:definition].is_a?(Hash) || params[:definition].is_a?(ActionController::Parameters)
      hash = params[:definition].respond_to?(:to_unsafe_h) ? params[:definition].to_unsafe_h : params[:definition].to_h
      return hash
    end
    if params[:json].present?
      return JSON.parse(params[:json].to_s)
    end
    if params[:url].present?
      url = params[:url].to_s.strip
      raise AgentTemplates::Importer::InvalidDefinition, "URL must be HTTPS" unless url.start_with?("https://")
      require "net/http"
      uri = URI.parse(url)
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 10, open_timeout: 5) do |http|
        req = Net::HTTP::Get.new(uri.request_uri)
        http.request(req)
      end
      raise AgentTemplates::Importer::InvalidDefinition, "fetch #{url} returned #{res.code}" unless res.is_a?(Net::HTTPSuccess)
      raise AgentTemplates::Importer::InvalidDefinition, "response too large (>1MB)" if res.body.bytesize > 1_000_000
      return JSON.parse(res.body)
    end
    raise AgentTemplates::Importer::InvalidDefinition, "provide definition / json / url"
  rescue JSON::ParserError => e
    raise AgentTemplates::Importer::InvalidDefinition, "not valid JSON: #{e.message}"
  end
end
