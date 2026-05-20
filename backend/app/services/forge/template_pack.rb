module Forge
  # Generates one template AND ensures every skill it references exists.
  #
  #   1. TemplateGenerator → AgentTemplate row (with `suggested_skill_slugs`).
  #   2. For each suggested slug missing from SkillDefinition:
  #        a. Try skills.sh search → if a strong match exists, ingest it.
  #        b. Else SkillGenerator → fresh SKILL.md authored by Claude.
  #   3. Returns { template, skills_resolved, skills_missing }.
  #
  # Used by Bootstrap to fan out across the IdeaBank without worrying that
  # a template ends up pointing at a slug that doesn't exist.
  class TemplatePack
    Result = Struct.new(:template, :brief, :skills_resolved, :skills_missing, :error,
                        keyword_init: true) do
      def ok? = error.nil?
    end

    def initialize(brief:, template_model: TemplateGenerator::DEFAULT_MODEL,
                   skill_model: SkillGenerator::DEFAULT_MODEL,
                   try_skills_sh: true)
      @brief = brief
      @template_model = template_model
      @skill_model = skill_model
      @try_skills_sh = try_skills_sh
    end

    def call
      tres = TemplateGenerator.new(brief: @brief, model: @template_model).call
      raise tres.error unless tres.ok?
      template = tres.template

      requested = Array(template.suggested_skill_slugs)
      existing = SkillDefinition.where(slug: requested).pluck(:slug).to_set
      missing = requested - existing.to_a

      resolved = []
      still_missing = []
      missing.each do |slug|
        new_skill = resolve_missing_skill(slug, template)
        if new_skill
          resolved << new_skill.slug
        else
          still_missing << slug
        end
      end

      # If we ended up with skill slugs the template suggested but couldn't
      # be created/found, drop them from the template so we don't ship a
      # template pointing at dead slugs.
      if still_missing.any?
        template.update!(suggested_skill_slugs: requested - still_missing)
      end

      Result.new(template: template, brief: @brief,
                 skills_resolved: existing.to_a + resolved,
                 skills_missing: still_missing)
    rescue => e
      Rails.logger.warn "[TemplatePack] #{@brief.is_a?(Hash) ? @brief[:slug] : @brief}: #{e.message}"
      Result.new(brief: @brief, error: e.message)
    end

    private

    def resolve_missing_skill(slug, template)
      if @try_skills_sh && ENV["SKILLS_SH_API_KEY"].present?
        ingested = try_skills_sh_for(slug)
        return ingested if ingested
      end
      try_generate_for(slug, template)
    end

    def try_skills_sh_for(slug)
      hits = SkillsShClient.search(slug.tr("-", " "), limit: 3)
      candidate = Array(hits["data"] || hits["results"]).first
      return nil unless candidate

      source = candidate["source"]
      candidate_slug = candidate["slug"] || slug
      manifest = SkillsShClient.get(source: source, slug: candidate_slug)
      # Force our local slug onto the ingest so the template's reference resolves.
      manifest["slug"] = slug
      ires = SkillIngestor.new(manifest: manifest, write_seed_file: false).call
      ires.ok? ? ires.skill : nil
    rescue SkillsShClient::Error, AnthropicClient::Error => e
      Rails.logger.info "[TemplatePack] skills.sh lookup failed for #{slug}: #{e.message}"
      nil
    end

    def try_generate_for(slug, template)
      brief = {
        slug: slug,
        name: slug.titleize,
        category: best_skill_category(template),
        description: "Capability needed by the #{template.name} template: #{slug.tr("-", " ")}.",
        notes: "Generated to fill a gap in template #{template.slug}'s suggested_skill_slugs.",
      }
      sres = SkillGenerator.new(brief: brief, model: @skill_model, write_file: false).call
      sres.ok? ? sres.skill : nil
    end

    def best_skill_category(template)
      case template.category
      when "sales"       then "sales"
      when "support"     then "communication"
      when "marketing"   then "content"
      when "engineering" then "engineering"
      when "ops"         then "productivity"
      else "common"
      end
    end
  end
end
