module Forge
  # Deterministic, no-LLM-call quality gate for generated rows.
  #
  # The TemplateGenerator system prompt sets voice + structure rules, but
  # models drift. Without a check, garbage ships to the marketplace. This
  # service applies fast deterministic rules and returns a structured
  # result. TemplatePack + SkillIngestor wire it in post-generation: rows
  # that fail are downgraded to published: false (the admin panel surfaces
  # them under "Pending Review").
  class QualityLint
    Result = Struct.new(:pass, :score, :warnings, keyword_init: true) do
      def to_s = "QualityLint: #{pass ? "PASS" : "FAIL"} score=#{score} #{warnings.size} warnings"
    end

    # Buzzwords ban — any of these in a markdown field is an automatic
    # warning + score penalty. Case-insensitive substring match. Source:
    # the system prompts already tell the model to avoid them, so seeing
    # them means the model regressed.
    BUZZWORDS = %w[
      synergy synergies leverage leveraging robust ecosystem journey
      holistic paradigm low-hanging deep-dive
      mission-critical world-class best-in-class table-stakes
      move-the-needle north-star circle-back
    ].freeze
    BUZZWORD_PHRASES = ["circle back", "deep dive", "low hanging", "move the needle",
                        "north star", "table stakes", "mission critical", "best in class",
                        "world class"].freeze

    # Skill section headers we expect to find. Match case-insensitively
    # and across small variants ("When NOT to Use" / "When to Avoid").
    SKILL_REQUIRED_HEADERS = [
      /^#+\s*when\s+to\s+use/i,
      /^#+\s*when\s+not\s+to\s+use|^#+\s*when\s+to\s+avoid/i,
      /^#+\s*auth(orization|entication)?(\s|$|:)|^#+\s*prerequisites/i,
      /^#+\s*endpoints?(\s|$|:)|^#+\s*tools?(\s|$|:)/i,
      /^#+\s*workflow|^#+\s*usage/i,
      /^#+\s*errors?(\s|$|:)|^#+\s*common\s+errors?/i,
      /^#+\s*rules?(\s|$|:)|^#+\s*do(\s|$)|^#+\s*don.t/i,
    ].freeze

    # ── Public entry points ─────────────────────────────────────────────

    def self.template(record)
      warnings = []

      check_present_and_lines(warnings, record, :identity_md, min: 6, max: 14)
      check_present_and_lines(warnings, record, :personality_md, min: 5, max: 10)
      check_instructions_md(warnings, record)
      check_signature(warnings, record)
      check_first_person(warnings, record)
      %i[identity_md personality_md instructions_md email_signature_md].each do |field|
        check_buzzwords(warnings, record, field)
      end

      score = compute_score(warnings)
      Result.new(pass: score >= 70, score: score, warnings: warnings)
    end

    def self.skill(record)
      warnings = []

      md = record.skill_md.to_s
      lines = md.lines.count
      if md.empty?
        warnings << { rule: :empty_body, message: "skill_md is empty" }
      elsif lines < 40
        warnings << { rule: :too_short, message: "skill_md is #{lines} lines, expected ≥40" }
      elsif lines > 1000
        warnings << { rule: :too_long, message: "skill_md is #{lines} lines, ≤1000 expected" }
      end

      found = SKILL_REQUIRED_HEADERS.count { |re| md.match?(re) }
      if found < 5
        warnings << { rule: :missing_sections,
                      message: "skill_md has only #{found}/7 expected section headers (When to Use / NOT / Auth / Endpoints / Workflow / Errors / Rules)" }
      end

      check_buzzwords(warnings, record, :skill_md)

      score = compute_score(warnings)
      Result.new(pass: score >= 70, score: score, warnings: warnings)
    end

    # ── Rule implementations ────────────────────────────────────────────

    def self.check_present_and_lines(warnings, record, field, min:, max:)
      text = record.public_send(field).to_s
      if text.strip.empty?
        warnings << { rule: :missing, message: "#{field} is empty" }
        return
      end
      lines = text.split(/\r?\n/).reject { |l| l.strip.empty? }.size
      if lines < min
        warnings << { rule: :too_short, message: "#{field} has #{lines} non-blank lines, expected ≥#{min}" }
      elsif lines > max
        warnings << { rule: :too_long, message: "#{field} has #{lines} non-blank lines, ≤#{max} expected" }
      end
    end

    def self.check_instructions_md(warnings, record)
      text = record.instructions_md.to_s
      if text.strip.empty?
        warnings << { rule: :missing, message: "instructions_md is empty" }
        return
      end
      sections = text.scan(/^##\s+\S/).size
      if sections < 3
        warnings << { rule: :too_few_sections,
                      message: "instructions_md has #{sections} ## sections, expected ≥3" }
      end
    end

    def self.check_signature(warnings, record)
      sig = record.email_signature_md.to_s
      if sig.strip.empty?
        warnings << { rule: :missing_signature, message: "email_signature_md is empty" }
      elsif !sig.include?("{{agent_name}}")
        warnings << { rule: :signature_no_token,
                      message: "email_signature_md missing {{agent_name}} substitution token" }
      end
    end

    def self.check_first_person(warnings, record)
      identity = record.identity_md.to_s
      return if identity.strip.empty?
      # Look at the first 5 non-blank lines — that's where "I am ..." should sit.
      head = identity.lines.reject { |l| l.strip.empty? }.first(5).join
      i_count = head.scan(/\bI\b/).size
      name_token = record.try(:name).to_s
      name_count = name_token.present? ? head.scan(/\b#{Regexp.escape(name_token)}\b/).size : 0
      if i_count == 0
        warnings << { rule: :not_first_person,
                      message: "identity_md doesn't open in first person (no `I` in first 5 lines)" }
      elsif name_count > i_count
        warnings << { rule: :third_person_drift,
                      message: "identity_md refers to the agent by name (#{name_count}x) more than in first person (#{i_count}x)" }
      end
    end

    def self.check_buzzwords(warnings, record, field)
      text = record.public_send(field).to_s.downcase
      return if text.empty?
      hits = []
      BUZZWORDS.each { |w| hits << w if text.match?(/\b#{Regexp.escape(w)}\b/) }
      BUZZWORD_PHRASES.each { |p| hits << p if text.include?(p) }
      if hits.any?
        warnings << { rule: :buzzwords, message: "#{field} contains banned phrases: #{hits.first(5).join(', ')}" }
      end
    end

    # 100 → start. Each warning subtracts. Buzzwords are a stated
    # NON-NEGOTIABLE rule in the generator system prompt, so a single
    # buzzword hit drops below the 70-pass threshold by itself. Missing
    # fields hurt the most.
    def self.compute_score(warnings)
      penalty = warnings.sum do |w|
        case w[:rule]
        when :missing, :empty_body                  then 30
        when :too_short, :too_long                  then 15
        when :too_few_sections, :missing_sections   then 15
        when :missing_signature, :signature_no_token then 10
        when :not_first_person, :third_person_drift then 15
        when :buzzwords                             then 35
        else 5
        end
      end
      [100 - penalty, 0].max
    end
  end
end
