module Forge
  # Read-only sibling of TemplatePack. Runs the same chain (analyzer →
  # resolver → generator → lint → dedup) but never writes to the DB.
  # Returns a structured preview the admin UI can render so the user
  # decides whether to commit (Create) or regenerate / cancel.
  #
  # The actual commit on user confirm goes through TemplatePack with
  # the user's possibly-edited fields layered onto the brief.
  class TemplatePreview
    Result = Struct.new(
      :template_attrs,           # Hash that WOULD become an AgentTemplate
      :requirements,             # SkillRequirementsAnalyzer output
      :resolved_skills,          # Array of { capability:, slug:, name:, via:, exists_in_db:, would_create: }
      :unresolved_capabilities,  # Array of capability strings nothing could match
      :lint,                     # QualityLint.template result on the proposed row (pass:, score:, warnings:)
      :duplicates,               # DedupDetector hits above threshold (array of { slug, score })
      :error,                    # populated on top-level failure
      keyword_init: true,
    ) do
      def ok? = error.nil? && template_attrs.present?
    end

    def initialize(brief:, template_model: TemplateGenerator::DEFAULT_MODEL,
                   analyze_model: AnthropicClient::DEFAULT_MODEL,
                   max_requirements: 10)
      @brief = brief.is_a?(Hash) ? brief : { description: brief.to_s }
      @template_model = template_model
      @analyze_model = analyze_model
      @max_requirements = max_requirements
    end

    def call
      # 1. Analyze capabilities (no DB writes — it's a single Claude call).
      requirements = SkillRequirementsAnalyzer.new(
        brief: @brief, model: @analyze_model, max_count: @max_requirements
      ).call
      return failure("requirements analyzer returned nothing") if requirements.empty?

      # 2. Resolve each capability in dry_run mode. We get back:
      #    - existing skill (exists_in_db: true) when local DB has a match
      #    - would_generate placeholder when DB has no match (caller can
      #      decide to commit, which fires the real SkillGenerator)
      resolved = []
      unresolved = []
      requirements.each do |req|
        res = SkillResolver.new(requirement: req, allow_generate: true, dry_run: true).call
        if res.ok?
          if res.skill
            resolved << {
              capability: req.capability,
              slug: res.skill.slug,
              name: res.skill.name,
              category: res.skill.category,
              via: res.via,
              exists_in_db: true,
              would_create: false,
              composio_toolkit: req.composio_toolkit,
            }
          elsif res.would_generate
            placeholder_slug = req.query.to_s.downcase.gsub(/[^a-z0-9]+/, "-").squeeze("-").gsub(/\A-|-\z/, "")
            resolved << {
              capability: req.capability,
              slug: placeholder_slug.presence || "unnamed",
              name: req.capability,
              category: nil,
              via: "would_generate",
              exists_in_db: false,
              would_create: true,
              composio_toolkit: req.composio_toolkit,
            }
          end
        else
          unresolved << req.capability
        end
      end

      return failure("no requirements could be resolved", requirements: requirements, unresolved_capabilities: unresolved) if resolved.empty?

      # 3. Generate the template (Claude call, no DB write). Pass the
      # existing-in-DB slugs so the generator constrains to those; the
      # would_create ones aren't yet real but we still let the model
      # reference their slugs because commit will create them right after.
      all_slugs = resolved.map { |r| r[:slug] }
      tres = TemplateGenerator.new(
        brief: @brief, model: @template_model,
        available_skills: all_slugs, dry_run: true
      ).call
      return failure("template generator: #{tres.error}") unless tres.ok?

      # tres.template is an OpenStruct in dry_run mode — convert to a plain
      # hash with the fields the UI cares about + the aggregated skills /
      # integrations we resolved.
      attrs = tres.template.to_h.stringify_keys
      attrs["suggested_skill_slugs"] = all_slugs
      attrs["suggested_integrations"] = resolved.flat_map { |r| r[:composio_toolkit] }.compact.uniq

      # 4. Quality lint on the proposed template. QualityLint operates
      # on a record-like object — we wrap the attrs in a lightweight
      # struct so it can call public_send on each field.
      lint_record = OpenStruct.new(attrs.merge("name" => attrs["name"]))
      lint = QualityLint.template(lint_record)

      # 5. Dedup against existing templates (read-only).
      dups = ActsAsTenant.without_tenant do
        candidates = AgentTemplate.where(system_template: true)
                                  .select(:id, :name, :slug, :identity_md, :suggested_skill_slugs)
        # DedupDetector expects records with name/identity_md/slug/suggested_skill_slugs
        # — pass our OpenStruct.
        DedupDetector.near_duplicates(lint_record, candidates: candidates)
                     .map { |m| { slug: m.other.slug, name: m.other.name, score: m.score } }
      end

      Result.new(
        template_attrs: attrs,
        requirements: requirements.map { |r| r.to_h },
        resolved_skills: resolved,
        unresolved_capabilities: unresolved,
        lint: { pass: lint.pass, score: lint.score, warnings: lint.warnings },
        duplicates: dups,
      )
    rescue => e
      Rails.logger.warn "[TemplatePreview] #{@brief[:slug] || @brief[:name]} failed: #{e.class}: #{e.message}"
      failure(e.message)
    end

    private

    def failure(msg, **extras)
      Result.new(error: msg, **extras)
    end
  end
end
