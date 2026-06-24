require "ostruct"

module Forge
  # Given a skill brief, calls Claude Sonnet 4.6 to produce a SKILL.md
  # (Anthropic skill pattern — When to use / NOT / Auth / Endpoints /
  # Workflow / Errors / Rules) plus a YAML frontmatter block matching the
  # existing skills in db/seeds/skills/<category>/.
  #
  # Writes BOTH:
  #   1. db/seeds/skills/<category>/<slug>.md (source-controlled, picked up
  #      next time `bin/rails runner db/seeds/skills.rb` runs)
  #   2. A SkillDefinition + SkillFile row directly so the skill shows up
  #      in the marketplace immediately, no manual reseed needed.
  class SkillGenerator
    Result = Struct.new(:skill, :brief, :file_path, :error, keyword_init: true) do
      def ok? = error.nil?
    end

    DEFAULT_MODEL = "claude-sonnet-4-6"
    CATEGORIES = %w[common communication content engineering finance productivity sales].freeze

    # Persist a pre-validated payload as a SkillDefinition + SkillFile
    # rows. Used by the AI Skill Creator's commit endpoint: the preview
    # already validated the payload via Claude; we don't want to call
    # Claude again at commit time (slow + non-deterministic — paths
    # could shift between runs, dropping the user's edits). This is
    # the canonical write path; SkillGenerator#call funnels through it.
    def self.persist!(parsed)
      hash = parsed.respond_to?(:stringify_keys) ? parsed.stringify_keys : parsed
      gen = new(brief: {})
      gen.send(:validate!, hash) # normalizes slug + caps additional_files
      gen.send(:upsert!, hash)
    end

    def initialize(brief:, model: DEFAULT_MODEL, write_file: true, dry_run: false)
      @brief = normalize_brief(brief)
      @model = model
      @write_file = write_file
      @dry_run = dry_run
    end

    def call
      raw = AnthropicClient.complete(prompt: build_prompt, model: @model, max_tokens: 6000, system: system_prompt)
      parsed = AnthropicClient.parse_json(raw)
      validate!(parsed)

      file_path = @write_file && !@dry_run ? write_seed_file!(parsed) : nil
      skill = @dry_run ? OpenStruct.new(parsed) : upsert!(parsed)
      Result.new(skill: skill, brief: @brief, file_path: file_path)
    rescue => e
      Rails.logger.warn "[SkillGenerator] #{@brief[:slug] || @brief[:name]} failed: #{e.message}"
      Result.new(brief: @brief, error: e.message)
    end

    private

    def normalize_brief(brief)
      case brief
      when String then { description: brief.strip }
      when Hash   then brief.transform_keys(&:to_sym)
      else raise ArgumentError, "brief must be a String or Hash"
      end
    end

    def system_prompt
      <<~SYS
        You author SKILL.md files for Sentrel agents. A SKILL.md is the agent's just-in-time playbook for a specific capability — Anthropic's skill pattern.

        Each SKILL.md MUST contain these sections, in this order:
          # <Skill Name>
          One-paragraph summary.
          ## When to Use
          ## When NOT to Use
          ## Auth & Prerequisites
          ## Endpoints / Tools
          ## Workflow
          ## Common Errors & Fixes
          ## Rules

        Voice rules:
        - Imperative second person ("Use this when...", "Do not...").
        - Concrete examples with code/curl/bash where relevant. Real endpoints, real headers.
        - No marketing. No "powerful", "robust", "seamless". Operator manual.
        - 80–250 lines. Long enough to be useful, short enough to fit context.

        Many skills benefit from supporting files — a small script, a JSON
        schema, a worked example. Include them in `additional_files` (up to
        3, optional, paths relative to the skill bundle root). For example
        a Salesforce skill might ship a `schemas/lead-create.json` showing
        the expected payload shape. A PDF generation skill might ship a
        `scripts/render.py` reference implementation. Most skills don't
        need any — only include them when they genuinely help the agent.

        Output: a SINGLE JSON object with these keys:
          slug, name, description, category (one of: common, communication, content, engineering, finance, productivity, sales),
          icon (lowercase lucide-react name), requires_connections (array of Composio service slugs the agent must connect first, may be []),
          required_capabilities (array of capability keys this skill needs enabled), skill_md (the full markdown body, NOT including frontmatter),
          additional_files (optional array of {path, content} — may be []).

        Return ONLY the JSON, no fences, no prose.
      SYS
    end

    def build_prompt
      <<~PROMPT
        === SKILL BRIEF ===
        slug:          #{@brief[:slug]}
        name:          #{@brief[:name]}
        category:      #{@brief[:category]}
        description:   #{@brief[:description]}
        notes:         #{@brief[:notes]}
        endpoints:     #{@brief[:endpoints]}
        requires_conn: #{@brief[:requires_connections]}

        === RESPONSE SHAPE ===
        {
          "slug": "kebab-case-slug",
          "name": "Human Readable Name",
          "description": "One short sentence agents use to decide if this skill is relevant.",
          "category": "<one of CATEGORIES>",
          "icon": "lowercase-lucide-name",
          "requires_connections": ["composio-service-slug"],
          "required_capabilities": [],
          "skill_md": "# Skill Name\\n\\nSummary...\\n\\n## When to Use\\n...",
          "additional_files": [
            { "path": "scripts/parse.py", "content": "..." },
            { "path": "schemas/request.json", "content": "..." }
          ]
        }

        `additional_files` is OPTIONAL — most skills should leave it as []. Include only when a supporting file genuinely helps the agent (a real code template, a schema the agent will fill in, a worked example payload).

        Return JSON only.
      PROMPT
    end

    def validate!(parsed)
      %w[slug name description category skill_md].each do |key|
        raise AnthropicClient::Error, "Missing field: #{key}" if parsed[key].to_s.strip.empty?
      end
      parsed["slug"] = parsed["slug"].downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
      parsed["category"] = "common" unless CATEGORIES.include?(parsed["category"].to_s)
      parsed["icon"] = (parsed["icon"].presence || "tool").to_s.downcase
      parsed["requires_connections"] = Array(parsed["requires_connections"]).map(&:to_s)
      parsed["required_capabilities"] = Array(parsed["required_capabilities"]).map(&:to_s)
      # Optional supporting files. Cap at 3 to keep skills lean. Sanitize
      # paths so we never write outside the skill bundle.
      raw_files = Array(parsed["additional_files"]).first(3)
      parsed["additional_files"] = raw_files.map do |f|
        path = f.is_a?(Hash) ? f["path"].to_s : ""
        content = f.is_a?(Hash) ? f["content"].to_s : ""
        next nil if path.empty? || content.empty?
        next nil if path.include?("..") # no traversal
        path = path.gsub(/\A\/+/, "")    # strip leading slashes
        next nil if path.casecmp?("SKILL.md") # SKILL.md handled separately
        { "path" => path, "content" => content }
      end.compact
      parsed
    end

    def write_seed_file!(parsed)
      dir = Rails.root.join("db/seeds/skills", parsed["category"])
      FileUtils.mkdir_p(dir)
      path = dir.join("#{parsed["slug"]}.md")
      frontmatter = {
        "slug" => parsed["slug"],
        "name" => parsed["name"],
        "description" => parsed["description"],
        "category" => parsed["category"],
        "icon" => parsed["icon"],
        "requires_connections" => parsed["requires_connections"]
      }.to_yaml.sub(/\A---\n/, "")
      File.write(path, "---\n#{frontmatter}---\n\n#{parsed["skill_md"]}\n")
      path.to_s
    end

    def upsert!(parsed)
      record = SkillDefinition.find_or_initialize_by(slug: parsed["slug"])
      record.assign_attributes(
        name: parsed["name"],
        description: parsed["description"],
        category: parsed["category"],
        icon: parsed["icon"],
        requires_connections: parsed["requires_connections"],
        required_capabilities: parsed["required_capabilities"],
        source: "built_in",
        visibility: "marketplace",
        published: true,
        skill_md: parsed["skill_md"],
      )
      record.save!

      primary = record.skill_files.find_or_initialize_by(path: "SKILL.md")
      primary.assign_attributes(content: parsed["skill_md"], file_type: "md", position: 0)
      primary.save!

      # Persist any supporting files. Position starts at 1 since SKILL.md
      # occupies 0. Existing files with the same path are updated in place;
      # files no longer listed are dropped so re-generating cleans up
      # stale supporting files.
      kept_paths = [ "SKILL.md" ]
      Array(parsed["additional_files"]).each_with_index do |f, idx|
        kept_paths << f["path"]
        sf = record.skill_files.find_or_initialize_by(path: f["path"])
        ext = File.extname(f["path"]).delete(".").presence || "txt"
        sf.assign_attributes(content: f["content"], file_type: ext, position: idx + 1)
        sf.save!
      end
      record.skill_files.where.not(path: kept_paths).destroy_all

      record
    end
  end
end
