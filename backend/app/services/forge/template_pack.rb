module Forge
  # Skills-first template generation.
  #
  #   1. SkillRequirementsAnalyzer — Claude lists the 3-10 *capabilities*
  #      this role needs ("send Gmail", "manage Calendar", "search web") —
  #      no slug names, just semantic requirements.
  #   2. SkillResolver — for each capability, walks the resolution chain
  #      (local DB → skills.sh → GitHub Search → SkillGenerator) and
  #      returns a real SkillDefinition. Cached across one bootstrap run so
  #      shared capabilities resolve once.
  #   3. TemplateGenerator — called with available_skills pinned to the
  #      resolved slugs. The template can only suggest skills that we know
  #      exist.
  #   4. Template's suggested_skill_slugs is forced to the resolver's
  #      output so the final row is internally consistent.
  #
  # Returns a Result with the template, the list of resolved skills, and
  # any capabilities that couldn't be sourced (rare — usually means all
  # four resolution stages failed).
  class TemplatePack
    Result = Struct.new(:template, :brief, :requirements, :resolved_skills,
                        :unresolved_capabilities, :error, keyword_init: true) do
      def ok? = error.nil?
    end

    def initialize(brief:,
                   template_model: TemplateGenerator::DEFAULT_MODEL,
                   skill_model: SkillGenerator::DEFAULT_MODEL,
                   analyze_model: AnthropicClient::DEFAULT_MODEL,
                   allow_generate_skills: true,
                   max_requirements: 10)
      @brief = brief
      @template_model = template_model
      @skill_model = skill_model
      @analyze_model = analyze_model
      @allow_generate_skills = allow_generate_skills
      @max_requirements = max_requirements
    end

    def call
      # 1. Analyze.
      requirements = SkillRequirementsAnalyzer.new(
        brief: @brief, model: @analyze_model, max_count: @max_requirements
      ).call

      if requirements.empty?
        return Result.new(brief: @brief, error: "requirements analyzer returned nothing")
      end

      # 2. Resolve each requirement (parallel within one TemplatePack — keeps
      # the outer Bootstrap concurrency budget bounded while still shaving
      # wall-clock time when GitHub Search is in play).
      resolved = []
      unresolved = []
      requirements.each do |req|
        res = SkillResolver.new(requirement: req, allow_generate: @allow_generate_skills).call
        if res.ok?
          resolved << { skill: res.skill, via: res.via, requirement: req }
        else
          unresolved << req
        end
      end

      if resolved.empty?
        return Result.new(brief: @brief, requirements: requirements,
                          unresolved_capabilities: unresolved,
                          error: "no requirements could be resolved to skills")
      end

      # 3. Generate the template constrained to the resolved skill slugs.
      resolved_slugs = resolved.map { |r| r[:skill].slug }
      tres = TemplateGenerator.new(
        brief: @brief, model: @template_model, available_skills: resolved_slugs
      ).call
      raise tres.error unless tres.ok?

      # 4. Pin the template's slugs to the resolver output. Even if the
      # model dropped one in its response, we want the final row to
      # reflect what the agent actually has access to.
      #
      # Also auto-aggregate suggested_integrations from the union of
      # resolved skills' requires_connections — that way the template's
      # integration list is exactly what the skills actually need, with
      # no drift between "skills want Gmail" and "template forgot to
      # suggest Gmail". AgentTemplate#missing_integrations_for(org) will
      # surface the unconnected ones at install time.
      aggregated_integrations = resolved
        .flat_map { |r| Array(r[:skill].requires_connections) }
        .map(&:to_s)
        .uniq
        .reject(&:blank?)

      tres.template.update!(
        suggested_skill_slugs: resolved_slugs,
        suggested_integrations: aggregated_integrations,
      )

      # Quality gate. Failures are downgraded to published: false so they
      # show up under "Pending Review" in the admin panel rather than
      # going straight to the marketplace. Re-running TemplatePack on the
      # same brief re-lints (and may republish if quality improved).
      lint = QualityLint.template(tres.template)
      unless lint.pass
        tres.template.update!(published: false)
        Rails.logger.warn "[Forge::TemplatePack] #{tres.template.slug} failed lint (score=#{lint.score}): " +
                          lint.warnings.map { |w| "[#{w[:rule]}] #{w[:message]}" }.join(" | ")
      end

      # Near-duplicate detection — log only; decision to merge is always
      # human. Skipped when the template is unpublished (no risk of
      # confusion in the marketplace yet).
      if tres.template.published?
        dups = DedupDetector.near_duplicates(tres.template)
        if dups.any?
          Rails.logger.warn "[Forge::TemplatePack] #{tres.template.slug} has #{dups.size} near-duplicates: " +
                            dups.first(3).map { |d| "#{d.other.slug}(#{d.score})" }.join(", ")
        end
      end

      Result.new(template: tres.template, brief: @brief,
                 requirements: requirements, resolved_skills: resolved,
                 unresolved_capabilities: unresolved)
    rescue => e
      Rails.logger.warn "[TemplatePack] #{brief_label}: #{e.message}"
      Result.new(brief: @brief, error: e.message)
    end

    private

    def brief_label
      return @brief unless @brief.is_a?(Hash)
      @brief[:slug] || @brief[:name] || "(unnamed)"
    end
  end
end
