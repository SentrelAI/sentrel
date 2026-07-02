module AgentTemplates
  # Imports an agent-bundle/v1 directory (agent.yaml + persona + skills) into a
  # SYSTEM AgentTemplate — the mechanism that makes GitHub bundles the source of
  # truth for /templates. Idempotent: re-importing the same slug updates the
  # template in place and only cuts a new AgentTemplateVersion when the
  # definition actually changed.
  #
  #   AgentTemplates::BundleImporter.new(
  #     dir: "/path/to/sentrel-agent-templates/marketing",
  #     source_url: "https://github.com/SentrelAI/agent-templates/tree/main/marketing",
  #     source_ref: "main",
  #   ).call  # => AgentTemplate
  #
  # Reuses AgentBundles::Manifest for the exact same agent.yaml parsing +
  # validation as `npx agentmanifest deploy`, so a template and a deploy read
  # the bundle identically.
  class BundleImporter
    class Error < StandardError; end

    def initialize(dir:, source_url:, source_ref: "main", slug: nil, created_by_user: nil)
      @dir = dir
      @source_url = source_url
      @source_ref = source_ref
      @slug = (slug.presence || File.basename(dir.to_s)).parameterize
      @created_by_user = created_by_user
    end

    def call
      manifest = AgentBundles::Manifest.parse!(self.class.read_dir(@dir))
      definition = build_definition(manifest)

      ActsAsTenant.without_tenant do
        AgentTemplate.transaction do
          template = AgentTemplate.find_or_initialize_by(slug: @slug)
          template.assign_attributes(flat_attrs(manifest, definition))
          template.save!
          maybe_new_version!(template, definition)
          template
        end
      end
    end

    # Read a bundle directory into the in-memory { "agent.yaml" => "...", ... }
    # map the Manifest expects (also lets a GitHub tarball reuse this path later).
    def self.read_dir(dir)
      raise Error, "bundle dir not found: #{dir}" unless File.directory?(dir)
      files = {}
      Dir.glob("**/*", base: dir).each do |rel|
        abs = File.join(dir, rel)
        files[rel] = File.read(abs) if File.file?(abs)
      end
      files
    end

    private

    def flat_attrs(m, definition)
      {
        name:                   m.name,
        role:                   m.role.presence || "Agent",
        description:            m.description.presence,
        category:              (m.data["category"].presence || "starter"),
        icon:                   m.data["icon"].presence,
        system_template:        true,
        published:              true,
        source_url:             @source_url,
        source_ref:             @source_ref,
        created_by_user_id:     @created_by_user&.id,
        license:                "CC-BY-4.0",
        suggested_provider:     (m.model["provider"].presence || "anthropic"),
        suggested_model:        (m.model["id"] || m.model["model_id"]),
        suggested_skill_slugs:  (m.skill_bundles.map { |s| s[:slug] } + m.builtin_skill_slugs).uniq,
        suggested_integrations: m.integrations.flat_map { |i| Array(i["service"]) + Array(i["any_of"]) }.uniq,
        capabilities:           definition["capabilities"],
        identity_md:            m.persona_md("identity"),
        personality_md:         m.persona_md("personality"),
        instructions_md:        m.persona_md("instructions"),
        variables:              m.inputs.map { |i| i["key"] }
      }.compact
    end

    # Mirrors the AgentTemplateVersion definition shape that Exporter/Publisher
    # emit, but sourced from the bundle manifest instead of a live Agent. Skills
    # are inlined as source:"custom" so the Installer can upsert the bundle.
    def build_definition(m)
      {
        "spec_version" => "1.1",
        "kind"         => "agent",
        "name"         => m.name,
        "role"         => m.role.presence || "Agent",
        "description"  => m.description.presence,
        "category"     => (m.data["category"].presence || "starter"),
        "icon"         => m.data["icon"].presence,
        "license"      => "CC-BY-4.0",
        "metadata"     => {
          "source"     => "bundle_import",
          "source_url" => @source_url,
          "source_ref" => @source_ref
        },
        "persona" => {
          "identity_md"        => m.persona_md("identity"),
          "personality_md"     => m.persona_md("personality"),
          "instructions_md"    => m.persona_md("instructions"),
          "email_signature_md" => nil
        },
        "model" => {
          "provider"       => (m.model["provider"].presence || "anthropic"),
          "model_id"       => (m.model["id"] || m.model["model_id"]),
          "temperature"    => m.model["temperature"],
          "max_tokens"     => m.model["max_tokens"],
          "thinking_level" => m.model["thinking_level"]
        }.compact,
        "capabilities" => (m.data["capabilities"].is_a?(Hash) ? m.data["capabilities"] : {}),
        "permissions"  => m.permissions,
        "goal"         => m.goal,
        "inputs"       => m.inputs,
        "skills"       => (
          m.skill_bundles.map { |sb| { "slug" => sb[:slug], "source" => "custom", "files" => sb[:files] } } +
          m.builtin_skill_slugs.map { |slug| { "slug" => slug, "source" => "built_in" } }
        ),
        "integrations_required" => m.integrations.filter_map { |i|
          if i["service"]
            { "service" => i["service"], "required" => i["required"], "why" => i["why"] }.compact
          elsif i["any_of"].present?
            { "any_of" => Array(i["any_of"]), "required" => i["required"], "why" => i["why"] }.compact
          end
        },
        "credentials_required"  => m.secret_names.map { |n| { "name_hint" => n } },
        "channels_required"     => m.channels.map { |c| { "type" => c["type"], "why" => c["why"] }.compact }
      }.compact
    end

    # Only cut a new version when the definition changed — keeps re-imports idempotent.
    def maybe_new_version!(template, definition)
      current = template.current_version&.definition
      return if current.present? && current == definition.deep_stringify_keys

      version = AgentTemplateVersion.create!(
        agent_template: template,
        version_number: AgentTemplateVersion.next_number_for(template),
        spec_version:   "1.1",
        definition:     definition,
        license:        template.license,
        changelog:      current.present? ? "Re-imported from bundle (#{@source_ref})" : "Imported from bundle",
        created_by_user_id: @created_by_user&.id,
        published:      true,
      )
      template.update!(current_version_id: version.id)
    end
  end
end
