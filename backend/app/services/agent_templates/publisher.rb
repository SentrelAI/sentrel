module AgentTemplates
  # Publish an Agent as a (new or updated) community template. Two modes:
  #
  #   1. Fresh publish (template: nil) — exports the agent, creates a brand
  #      new AgentTemplate, attaches v1.
  #   2. Re-publish (template: existing) — exports again, creates a new
  #      AgentTemplateVersion (n+1), advances template.current_version_id.
  #      Old versions stay queryable and installable.
  #
  # All version rows are immutable once created; "edit a template" === "publish
  # a new version." This is what makes "install v3 of CasperSDR" trustworthy.
  class Publisher
    def initialize(agent:, user:, name:, category: nil, description: nil,
                   license: nil, changelog: nil, template: nil)
      @agent       = agent
      @user        = user
      @name        = name
      @category    = category
      @description = description
      @license     = license.presence || "CC-BY-4.0"
      @changelog   = changelog
      @template    = template
    end

    def call
      definition = Exporter.new(@agent, exported_by: @user).call.merge(
        "name"        => @name,
        "category"    => @category,
        "description" => @description,
        "license"     => @license,
      ).compact

      AgentTemplate.transaction do
        template = @template || create_template!(definition)
        version  = AgentTemplateVersion.create!(
          agent_template: template,
          version_number: AgentTemplateVersion.next_number_for(template),
          spec_version:   definition["spec_version"],
          definition:     definition,
          license:        @license,
          changelog:      @changelog,
          created_by_user_id: @user.id,
          published:      true,
        )
        # Mirror headline fields into the row so list pages don't need to
        # JOIN versions for every render. Definition stays source of truth.
        template.update!(
          current_version_id: version.id,
          name:        definition["name"],
          description: definition["description"] || template.description,
          category:    definition["category"] || template.category,
          license:     @license,
          identity_md:        definition.dig("persona", "identity_md"),
          personality_md:     definition.dig("persona", "personality_md"),
          instructions_md:    definition.dig("persona", "instructions_md"),
          email_signature_md: definition.dig("persona", "email_signature_md"),
          capabilities:           definition["capabilities"] || {},
          suggested_skill_slugs:  Array(definition["skills"]).map { |s| s["slug"] },
          suggested_integrations: Array(definition["integrations_required"]).map { |i| i["service"] }.compact,
          suggested_provider:     definition.dig("model", "provider"),
          suggested_model:        definition.dig("model", "model_id"),
          published:   true,
        )
        template
      end
    end

    private

    def create_template!(definition)
      AgentTemplate.create!(
        slug: AgentTemplate.unique_slug_for(@name, @agent.organization_id, @user.id),
        name: @name,
        role: @agent.role,
        description: @description.presence || "Published from #{@agent.name}",
        icon: definition["icon"],
        organization_id: @agent.organization_id,
        created_by_user_id: @user.id,
        system_template: false,
        published: true,
        category: (@category.presence || "starter"),
        license: @license,
        capabilities: {},
        suggested_skill_slugs: [],
        suggested_integrations: [],
        variables: [],
      )
    end
  end
end
