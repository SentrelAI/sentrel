require "yaml"
require "fileutils"

module AgentTemplates
  # Converts an AgentTemplate row → an agent-bundle/v1 directory on disk
  # (agent.yaml + persona markdown + any custom skill bundles). The inverse of
  # AgentTemplates::BundleImporter — together they make the Ruby seed catalog
  # migratable into forkable GitHub bundles (point 5).
  #
  # Fidelity: persona, model, category, icon, capabilities, inputs and
  # integrations round-trip. Skills are classified — built-in/platform skills
  # (web-search, send-email, …) become `builtin_skills:` slug refs; custom /
  # org-authored skills are embedded as skills/<slug>/SKILL.md bundles.
  #
  #   AgentTemplates::BundleExporter.new(template).write_to("tmp/bundles")
  #   # => "tmp/bundles/ceo"
  class BundleExporter
    PERSONA_FILES = { "identity" => :identity_md, "personality" => :personality_md, "instructions" => :instructions_md }.freeze

    def initialize(template)
      @t = template
    end

    # Writes the bundle under <root>/<slug> and returns that directory path.
    def write_to(root)
      dir = File.join(root, @t.slug)
      FileUtils.mkdir_p(dir)

      PERSONA_FILES.each do |name, col|
        body = @t.public_send(col)
        File.write(File.join(dir, "#{name}.md"), body) if body.present?
      end

      embed_custom_skills!(dir)
      File.write(File.join(dir, "agent.yaml"), YAML.dump(manifest_hash))
      dir
    end

    # The parsed agent.yaml hash (also used by specs to assert without disk IO).
    def manifest_hash
      h = {
        "spec"        => AgentBundles::Manifest::SPEC,
        "name"        => @t.name,
        "role"        => @t.role.presence,
        "category"    => category,
        "icon"        => @t.icon.presence,
        "description" => @t.description.presence,
        "model"       => model_block,
        "persona"     => persona_block
      }.compact

      h["builtin_skills"] = builtin_slugs if builtin_slugs.any?
      h["skills"]         = custom_slugs.map { |s| "./skills/#{s}" } if custom_slugs.any?
      h["capabilities"]   = @t.capabilities if @t.capabilities.present?
      h["inputs"]         = inputs_block if inputs_block.any?
      h["integrations"]   = integrations_block if integrations_block.any?
      h
    end

    private

    def category
      cats = AgentTemplate::CATEGORIES
      cats.include?(@t.category) ? @t.category : "starter"
    end

    def model_block
      { "provider" => @t.suggested_provider.presence || "anthropic", "id" => @t.suggested_model.presence }.compact
    end

    def persona_block
      PERSONA_FILES.keys.each_with_object({}) do |name, acc|
        col = PERSONA_FILES[name]
        acc[name] = "./#{name}.md" if @t.public_send(col).present?
      end
    end

    def inputs_block
      Array(@t.variables).map do |key|
        { "key" => key.to_s, "label" => key.to_s.tr("_", " ").capitalize, "required" => true }
      end
    end

    def integrations_block
      Array(@t.suggested_integrations).map { |s| { "service" => s.to_s, "why" => "Used by this role." } }
    end

    # Skill slug → built-in vs custom. A SkillDefinition marked system? (the
    # platform/built-in skills the runtime already ships) becomes a builtin ref;
    # anything else (org-authored, generated with files) is embedded. Unknown
    # slugs are treated as built-in refs so we never silently drop wiring.
    def skill_defs
      @skill_defs ||= SkillDefinition.where(slug: Array(@t.suggested_skill_slugs)).index_by(&:slug)
    end

    def builtin_slugs
      @builtin_slugs ||= Array(@t.suggested_skill_slugs).select do |slug|
        d = skill_defs[slug]
        d.nil? || d.system?
      end.uniq
    end

    def custom_slugs
      @custom_slugs ||= (Array(@t.suggested_skill_slugs) - builtin_slugs).uniq
    end

    # Embed each custom skill's files (SKILL.md + supporting) as a bundle dir.
    def embed_custom_skills!(dir)
      custom_slugs.each do |slug|
        d = skill_defs[slug]
        next unless d
        skill_dir = File.join(dir, "skills", slug)
        FileUtils.mkdir_p(skill_dir)
        files = skill_files_for(d)
        files.each do |rel, body|
          path = File.join(skill_dir, rel)
          FileUtils.mkdir_p(File.dirname(path))
          File.write(path, body)
        end
      end
    end

    def skill_files_for(d)
      rows = d.skill_files.order(:position).to_h { |f| [ f.path, f.content.to_s ] }
      rows["SKILL.md"] = d.skill_md.to_s if rows["SKILL.md"].to_s.strip.empty? && d.skill_md.present?
      rows["SKILL.md"] = "# #{d.name}\n\n#{d.description}\n" if rows["SKILL.md"].to_s.strip.empty?
      rows
    end
  end
end
