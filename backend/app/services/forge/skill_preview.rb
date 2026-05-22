require "ostruct"

module Forge
  # Read-only sibling of SkillGenerator. Calls the same Claude prompt with
  # write_file: false + dry_run: true to assemble a previewable SKILL.md +
  # supporting-files manifest. No DB writes. The admin UI renders this so
  # the user decides whether to commit (Create) or regenerate / cancel.
  #
  # On commit the admin controller re-runs SkillGenerator with write_file:
  # true + dry_run: false; the user's edits to skill_md (if any) are
  # layered on top of the freshly-persisted record.
  class SkillPreview
    Result = Struct.new(
      :skill_attrs,       # Hash that WOULD become a SkillDefinition
      :additional_files,  # Array of { path, content }
      :lint,              # QualityLint.skill result
      :duplicates,        # DedupDetector hits above threshold
      :error,
      keyword_init: true,
    ) do
      def ok? = error.nil? && skill_attrs.present?
    end

    def initialize(brief:, model: SkillGenerator::DEFAULT_MODEL)
      @brief = brief.is_a?(Hash) ? brief : { description: brief.to_s }
      @model = model
    end

    def call
      gen = SkillGenerator.new(brief: @brief, model: @model, write_file: false, dry_run: true).call
      return failure(gen.error) unless gen.ok?

      # SkillGenerator in dry_run returns an OpenStruct of the parsed JSON.
      skill = gen.skill
      attrs = skill.to_h.stringify_keys

      additional_files = Array(attrs["additional_files"]).map do |f|
        { "path" => f["path"], "content" => f["content"] }
      end

      # QualityLint.skill expects a record with skill_md / source / etc.
      # Mark as "built_in" so the section-header rules apply (imported
      # skills bypass them).
      lint_record = OpenStruct.new(attrs.merge("source" => "built_in"))
      lint = QualityLint.skill(lint_record)

      # Cheap dup detection for skills: exact slug collision (would mean
      # commit silently updates the existing row via find_or_initialize_by)
      # plus same-name match. DedupDetector's identity_jaccard is template-
      # specific, so we don't reuse it here.
      duplicates = []
      slug = attrs["slug"].to_s
      name = attrs["name"].to_s
      if slug.present?
        SkillDefinition.where("LOWER(slug) = ? OR LOWER(name) = ?", slug.downcase, name.downcase)
                       .limit(5)
                       .each do |other|
          score = other.slug.downcase == slug.downcase ? 1.0 : 0.9
          duplicates << { slug: other.slug, name: other.name, score: score }
        end
      end

      Result.new(
        skill_attrs: attrs.slice("slug", "name", "description", "category", "icon",
                                  "requires_connections", "required_capabilities", "skill_md"),
        additional_files: additional_files,
        lint: { pass: lint.pass, score: lint.score, warnings: lint.warnings },
        duplicates: duplicates,
      )
    rescue => e
      Rails.logger.warn "[SkillPreview] #{@brief[:slug] || @brief[:name]} failed: #{e.class}: #{e.message}"
      failure(e.message)
    end

    private

    def failure(msg)
      Result.new(error: msg)
    end
  end
end
