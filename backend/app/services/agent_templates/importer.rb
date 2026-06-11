module AgentTemplates
  # Take a portable agent.json hash and create an AgentTemplate (+ initial
  # AgentTemplateVersion) in the current org. The output is a TEMPLATE,
  # not an Agent — installation is a separate step (AgentTemplates::Installer).
  #
  #   AgentTemplates::Importer.new(definition, user:, organization:).call
  #   # => AgentTemplate
  #
  # Validates spec_version. Silent-forks any skill slug that already exists
  # in the org as a different SkillDefinition (the imported template gets
  # `<slug>-imported-<n>`-suffixed copies so existing org skills are never
  # mutated by an untrusted import).
  class Importer
    class UnsupportedSpec < StandardError; end
    class InvalidDefinition < StandardError; end

    SUPPORTED_SPEC_VERSIONS = %w[1.0 1.1].freeze

    def initialize(definition, user:, organization:)
      @definition   = normalize(definition)
      @user         = user
      @organization = organization
    end

    def call
      validate!

      ActsAsTenant.with_tenant(@organization) do
        AgentTemplate.transaction do
          # Rewrite the embedded skill bundles into the org first so the
          # version's definition references the org-local slugs. Returns the
          # (possibly forked) definition.
          definition = upsert_skills_and_rewrite!

          template = AgentTemplate.create!(
            slug: AgentTemplate.unique_slug_for(definition["name"], @organization.id, @user.id),
            name: definition["name"],
            role: definition["role"],
            description: definition["description"],
            icon: definition["icon"],
            organization_id: @organization.id,
            created_by_user_id: @user.id,
            system_template: false,
            published: true,
            category: (definition["category"].presence || "starter"),
            license: definition["license"].presence || "CC-BY-4.0",
            identity_md:        definition.dig("persona", "identity_md"),
            personality_md:     definition.dig("persona", "personality_md"),
            instructions_md:    definition.dig("persona", "instructions_md"),
            email_signature_md: definition.dig("persona", "email_signature_md"),
            capabilities:           definition["capabilities"] || {},
            suggested_skill_slugs:  Array(definition["skills"]).map { |s| s["slug"] },
            suggested_integrations: Array(definition["integrations_required"]).map { |i| i["service"] }.compact,
            suggested_provider:     definition.dig("model", "provider"),
            suggested_model:        definition.dig("model", "model_id"),
            variables: [],
          )

          version = AgentTemplateVersion.create!(
            agent_template: template,
            version_number: 1,
            spec_version:   definition["spec_version"],
            definition:     definition,
            license:        definition["license"],
            changelog:      "Imported via agent.json",
            created_by_user_id: @user.id,
            published:      true,
          )
          template.update!(current_version_id: version.id)
          template
        end
      end
    end

    private

    def normalize(input)
      case input
      when String then JSON.parse(input)
      when Hash   then input.deep_stringify_keys
      else
        raise InvalidDefinition, "definition must be a JSON string or Hash (got #{input.class})"
      end
    rescue JSON::ParserError => e
      raise InvalidDefinition, "definition is not valid JSON: #{e.message}"
    end

    def validate!
      unless SUPPORTED_SPEC_VERSIONS.include?(@definition["spec_version"])
        raise UnsupportedSpec,
              "spec_version #{@definition['spec_version'].inspect} not supported; this engine handles #{SUPPORTED_SPEC_VERSIONS.join(', ')}"
      end
      raise InvalidDefinition, "missing 'name'" if @definition["name"].blank?
      raise InvalidDefinition, "missing 'role'" if @definition["role"].blank?
    end

    # Per-entry handling depends on the entry's `source`:
    #
    #   - "platform" → REFERENCE: look up the seeded built-in SkillDefinition
    #     by slug (organization_id IS NULL, source: "built_in"). If found,
    #     leave the entry alone — Installer links the existing seed. If
    #     missing on this instance, record it under
    #     metadata.missing_platform_skills so the template UI can surface
    #     the gap; the entry stays so a later seed rollout would heal it.
    #     Never fork a platform skill — that would create a frozen copy of
    #     a seed that may evolve upstream.
    #
    #   - "custom" or absent (legacy 1.0) → BUNDLE: same upsert/fork
    #     handling as before. Original org skills are never mutated; a
    #     content-conflicting import gets `<slug>-imported-<n>`.
    #
    # Returns the (possibly rewritten) definition.
    def upsert_skills_and_rewrite!
      working = @definition.deep_dup
      missing_platform = []

      Array(working["skills"]).each_with_index do |skill, idx|
        if skill["source"] == "platform"
          if SkillDefinition.where(source: "built_in", slug: skill["slug"]).none?
            Rails.logger.warn "[AgentTemplates::Importer] platform skill #{skill["slug"].inspect} not seeded on this instance"
            missing_platform << skill["slug"]
          end
          # Platform refs stay as-is — Installer resolves them at hire-time.
          next
        end

        original_slug = skill["slug"]
        existing = SkillDefinition.where(slug: original_slug)
                                   .where("organization_id = ? OR organization_id IS NULL", @organization.id)
                                   .first
        effective_slug =
          if existing.nil?
            # No reusable skill in (this org OR platform) — but slugs are
            # GLOBALLY unique and another org may own this one. Fork the
            # name when taken, otherwise cross-org imports of the same
            # bundle fail with "Slug has already been taken".
            target = SkillDefinition.exists?(slug: original_slug) ? unique_skill_slug(original_slug) : original_slug
            install_skill!(skill, target)
            target
          elsif skills_equivalent?(existing, skill)
            original_slug
          else
            forked = unique_skill_slug(original_slug)
            install_skill!(skill, forked)
            forked
          end
        working["skills"][idx]["slug"] = effective_slug
      end

      working["suggested_skill_slugs"] = Array(working["skills"]).map { |s| s["slug"] }
      if missing_platform.any?
        (working["metadata"] ||= {})["missing_platform_skills"] = missing_platform
      end
      working
    end

    def install_skill!(bundle, slug)
      record = SkillDefinition.create!(
        organization_id: @organization.id,
        slug:        slug,
        name:        bundle["name"].presence || slug.humanize,
        description: bundle["description"],
        category:    bundle["category"].presence || "common",
        icon:        bundle["icon"],
        source:      "imported",
        visibility:  "private",
        published:   true,
        requires_connections:  Array(bundle["requires_connections"]),
        required_capabilities: Array(bundle["required_capabilities"]),
        skill_md:    primary_md(bundle),
      )
      Array(bundle["files"]).each_with_index do |f, pos|
        record.skill_files.create!(
          path:      f["path"],
          content:   f["content"],
          file_type: f["file_type"].presence || infer_file_type(f["path"]),
          position:  pos,
        )
      end
    end

    def primary_md(bundle)
      md_file = Array(bundle["files"]).find { |f| f["path"].to_s.casecmp?("SKILL.md") }
      md_file&.dig("content")
    end

    def infer_file_type(path)
      ext = File.extname(path.to_s).delete_prefix(".").downcase
      ext.presence || "other"
    end

    def skills_equivalent?(existing, bundle)
      existing.skill_md.to_s.strip == primary_md(bundle).to_s.strip &&
        existing.skill_files.count == Array(bundle["files"]).size
    end

    def unique_skill_slug(base)
      n = 1
      loop do
        candidate = "#{base}-imported-#{n}"
        return candidate unless SkillDefinition.where(slug: candidate).exists?
        n += 1
        return "#{base}-imported-#{SecureRandom.hex(2)}" if n > 50
      end
    end
  end
end
