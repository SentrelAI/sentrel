module Forge
  # Given a role brief, calls Claude Sonnet 4.6 to produce a full AgentTemplate
  # row (identity_md / personality_md / instructions_md, capabilities, suggested
  # skills, model) matching the voice of the hand-written seeds in
  # db/seeds/agent_templates.rb. Writes the row idempotently (upserts on slug).
  #
  # Run a batch via Forge::Orchestrator or `rake forge:templates`.
  class TemplateGenerator
    Result = Struct.new(:template, :brief, :error, keyword_init: true) do
      def ok? = error.nil?
    end

    DEFAULT_MODEL = "claude-sonnet-4-6"

    # brief is either a String (free-text role description) or a Hash with
    # keys: :slug, :name, :role, :category, :description, :notes, :icon.
    def initialize(brief:, model: DEFAULT_MODEL, available_skills: nil, dry_run: false)
      @brief = normalize_brief(brief)
      @model = model
      @dry_run = dry_run
      @available_skills = available_skills || SkillDefinition.where(published: true).pluck(:slug)
    end

    def call
      raw = AnthropicClient.complete(prompt: build_prompt, model: @model, max_tokens: 6000, system: system_prompt)
      parsed = AnthropicClient.parse_json(raw)
      validate!(parsed)

      template = @dry_run ? OpenStruct.new(parsed) : upsert!(parsed)
      Result.new(template: template, brief: @brief)
    rescue => e
      Rails.logger.warn "[TemplateGenerator] #{@brief[:slug] || @brief[:name]} failed: #{e.message}"
      Result.new(brief: @brief, error: e.message)
    end

    private

    def normalize_brief(brief)
      case brief
      when String
        { description: brief.strip }
      when Hash
        brief.transform_keys(&:to_sym)
      else
        raise ArgumentError, "brief must be a String or Hash"
      end
    end

    def system_prompt
      <<~SYS
        You write agent templates for Double.md — a multi-tenant platform where AI agents act as employees inside a company. You are NOT writing marketing copy. You are writing the agent's internal first-person identity, personality, and operating manual.

        Voice rules (NON-NEGOTIABLE):
        - First person. "I am Sarah." not "Sarah is..."
        - Concrete and specific. "I close $50k–$500k SaaS deals" beats "I drive revenue."
        - No buzzwords: synergy, leverage, holistic, robust, journey, ecosystem, paradigm. Strike them.
        - Short sentences. Operator voice. Plain English.
        - Real opinions about what matters and what doesn't ("I care about X. I don't care about Y.")
        - Substitution tokens: {{agent_name}}, {{company_name}}, {{user_name}} are filled at agent-create time. Use them literally where appropriate.

        Output rules:
        - Return ONLY a single JSON object. No markdown fences. No prose before/after.
        - identity_md: 6–14 lines. Who the agent is, who they report to, what they own, what they explicitly don't.
        - personality_md: 5–10 lines. How they communicate. Tone, defaults, what they refuse to do (e.g. "I don't say 'circle back'").
        - instructions_md: 25–60 lines of operating manual. Markdown with `## Headers` for sections like Delegation, Prioritization, Information diet, Escalation, Output format. Concrete tools/skills they should use ({create_task, search_messages, web_search, send_email}).
        - email_signature_md: 3–5 lines. Closes the role's outbound email in the role's voice. MUST include the literal `{{agent_name}}` token. No "Best regards" / "Sincerely" boilerplate — use language that fits the role (e.g. an SDR's "— Sarah · SDR @ {{company_name}}" or a CFO's "{{agent_name}}, Finance · {{company_name}}"). One blank line between sign-off line and contact line is fine.
      SYS
    end

    def build_prompt
      <<~PROMPT
        === ROLE BRIEF ===
        slug:        #{@brief[:slug]}
        name:        #{@brief[:name]}
        role:        #{@brief[:role]}
        category:    #{@brief[:category]}
        description: #{@brief[:description]}
        notes:       #{@brief[:notes]}

        === AVAILABLE SKILL SLUGS (pick 1–6 that genuinely fit) ===
        #{@available_skills.sort.join(", ")}

        === MODEL SELECTION ===
        - claude-opus-4-7      → heavy reasoning, multi-step planning, high-stakes decisions
        - claude-sonnet-4-6    → daily driver, writing, general agent work (DEFAULT)
        - claude-haiku-4-5-20251001 → high-volume, fast, low-stakes replies

        === RESPONSE SHAPE (return EXACTLY these keys) ===
        {
          "slug": "kebab-case-slug",
          "name": "Human Display Name",
          "role": "Role title (3-4 words max)",
          "category": "one of: starter | sales | support | marketing | engineering | people | personal | ops",
          "description": "One sentence describing what this agent does for a company.",
          "icon": "lucide-react icon name e.g. Briefcase, Headphones, PenTool, Code, Calculator, Scale",
          "suggested_provider": "anthropic",
          "suggested_model": "<model id from MODEL SELECTION>",
          "suggested_manager_role": "<role title of who they report to, or null for top-level>",
          "suggested_skill_slugs": ["slug-1", "slug-2"],
          "suggested_integrations": ["service-name-1", "service-name-2"],
          "capabilities": {
            "knowledge_base": { "enabled": true },
            "scheduling":     { "enabled": true|false },
            "tasks":          { "enabled": true|false },
            "integrations":   { "enabled": true|false },
            "recall":         { "enabled": true|false },
            "send_media":     { "enabled": true|false }
          },
          "variables": ["company_name", "user_name"],
          "identity_md":    "I am {{agent_name}}, the ...\\n\\n...",
          "personality_md": "I am direct and ...\\n\\n...",
          "instructions_md":"# How I work\\n\\n## Section\\n- ...\\n",
          "email_signature_md": "— {{agent_name}}\\nSDR · {{company_name}}"
        }

        Substitution tokens to USE in markdown fields (literally, NOT replaced): {{agent_name}}, {{company_name}}, {{user_name}}.

        Return JSON only.
      PROMPT
    end

    def validate!(parsed)
      %w[slug name role identity_md personality_md instructions_md].each do |key|
        raise AnthropicClient::Error, "Missing required field: #{key}" if parsed[key].to_s.strip.empty?
      end
      parsed["slug"] = parsed["slug"].downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
      parsed["category"] = "starter" unless AgentTemplate::CATEGORIES.include?(parsed["category"].to_s)
      parsed["suggested_provider"] = (parsed["suggested_provider"].presence || "anthropic").to_s
      parsed["suggested_model"] = (parsed["suggested_model"].presence || "claude-sonnet-4-6").to_s
      parsed["suggested_skill_slugs"] = Array(parsed["suggested_skill_slugs"]).select { |s| @available_skills.include?(s) }
      parsed["suggested_integrations"] = Array(parsed["suggested_integrations"]).map(&:to_s)
      parsed["capabilities"] = (parsed["capabilities"] || {}).slice("knowledge_base", "scheduling", "tasks", "integrations", "recall", "send_media")
      parsed["variables"] = Array(parsed["variables"]).map(&:to_s)
      # email_signature_md is optional but if present should be a non-empty
      # string ≤500 chars — long signatures bloat every outbound email.
      sig = parsed["email_signature_md"].to_s.strip
      parsed["email_signature_md"] = sig.empty? ? nil : sig[0, 500]
      parsed
    end

    def upsert!(parsed)
      record = AgentTemplate.find_or_initialize_by(slug: parsed["slug"])
      record.assign_attributes(
        name: parsed["name"],
        role: parsed["role"],
        category: parsed["category"],
        description: parsed["description"],
        icon: parsed["icon"],
        organization_id: nil,
        system_template: true,
        published: true,
        suggested_provider: parsed["suggested_provider"],
        suggested_model: parsed["suggested_model"],
        suggested_manager_role: parsed["suggested_manager_role"],
        suggested_skill_slugs: parsed["suggested_skill_slugs"],
        suggested_integrations: parsed["suggested_integrations"],
        capabilities: parsed["capabilities"],
        variables: parsed["variables"],
        identity_md: parsed["identity_md"],
        personality_md: parsed["personality_md"],
        instructions_md: parsed["instructions_md"],
        email_signature_md: parsed["email_signature_md"],
      )
      record.save!
      record
    end
  end
end
