require "ostruct"

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
      # Up to 2 attempts. First failure on JSON parse usually means the
      # model dropped out of structured-output mid-stream ("...{...\"I'll
      # add more...\"..."). A second attempt with a stricter reminder
      # usually fixes it.
      parsed = nil
      attempts = 0
      last_err = nil
      while attempts < 2 && parsed.nil?
        attempts += 1
        prompt = attempts == 1 ? build_prompt : build_prompt + "\n\nReturn ONLY valid JSON — your last response had prose mixed in. JSON only. No commentary."
        raw = AnthropicClient.complete(prompt: prompt, model: @model, max_tokens: 8000, system: system_prompt)
        begin
          parsed = AnthropicClient.parse_json(raw)
        rescue AnthropicClient::Error => e
          last_err = e
          parsed = nil
          Rails.logger.warn "[TemplateGenerator] #{@brief[:slug] || @brief[:name]} attempt #{attempts} JSON parse failed: #{e.message[0, 150]}"
        end
      end
      raise last_err if parsed.nil?

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
        You write agent templates for Double.md — a multi-tenant platform where AI agents act as employees inside a company. You are NOT writing marketing copy or a job description. You are writing the agent's internal first-person identity AND a real operating manual the agent will read every time it boots.

        Voice rules (NON-NEGOTIABLE):
        - First person. "I am Sarah." not "Sarah is..."
        - Concrete and specific. "I close $50k–$500k SaaS deals" beats "I drive revenue." Use real numbers, real time-budgets, real tool names.
        - No buzzwords: synergy, leverage, holistic, robust, journey, ecosystem, paradigm. Strike them.
        - Short sentences. Operator voice. Plain English.
        - Real opinions about what matters and what doesn't ("I care about X. I don't care about Y.")
        - Substitution tokens: {{agent_name}}, {{company_name}}, {{user_name}} are filled at agent-create time. Use them literally where appropriate.

        Depth rules (also NON-NEGOTIABLE):
        - instructions_md MUST be substantive — 50–100 lines is the target, NOT 15. A job description is not enough. The agent must be able to operate on day 1 from this manual alone.
        - Every section in instructions_md MUST contain CONCRETE moves, not principles. Bad: "I prioritize ruthlessly." Good: "I run three loops/day in this order: 1) Inbox (90 min), 2) Reports (60 min), 3) Decisions (rest)."
        - Name SPECIFIC tools/skills the agent calls (these exist in the engine): `create_task(assign_to:, due:)`, `search_messages(query:)`, `search_activity(role:, since:)`, `web_search(query:)`, `send_email(to:, subject:, body:)`, `request_approval(action:, rationale:)`, `knowledge_base.search(q:)`, `share_file(path:)`. Use them in code-block-style when you describe an action.
        - For roles with money, time, or risk decisions: include DOLLAR THRESHOLDS or PERCENTAGE THRESHOLDS or TIME BUDGETS where realistic. E.g. "Refunds under $50 I auto-approve, over $50 I `request_approval` to Finance." or "I escalate at 24h unanswered, not before."
        - Include 3–5 EXAMPLE SCENARIOS in instructions_md showing how the agent reacts in concrete situations. Format: "## Example: X arrives in inbox → my response: ..."
        - At least one section MUST describe what the agent explicitly DOES NOT do (boundary with adjacent roles).
        - At least one section MUST describe ESCALATION (when to ping the manager, when to ping {{user_name}}).
        - The output_format / output style section should give the format the agent uses for replies, status updates, briefs — actual templates, not abstract guidance.

        Bad vs good example for instructions_md:

        BAD (this fails — too thin, too abstract):
          ## Review workflow
          - I read the doc before commenting.
          - I flag issues as BLOCKER/RISK/NIT.
          - I propose the fix, not just the problem.

        GOOD (concrete, named tools, thresholds, examples):
          ## Review workflow
          When a doc lands in my queue (`create_task` from anyone), I run this sequence:
          1. `knowledge_base.search("DPA template")` to load our standard positions.
          2. Read the whole doc end-to-end before commenting.
          3. Classify each issue:
             - **BLOCKER** — limitation-of-liability cap < $1M, mutual indemnity missing, data-residency commitment to a region we don't cover, audit rights granted without our SOC 2 carve-out
             - **RISK** — terms outside our playbook but accepted before; surface to deal-desk
             - **NIT** — wording preference only; comment but don't gate
          4. For each BLOCKER, draft proposed redline language matching the playbook.
          5. `create_task(assign_to: "deal-desk", due: 24h)` with my summary.

          ## Example: vendor MSA arrives via email
          → `email.parse_attachment` to extract the PDF
          → `knowledge_base.search("vendor MSA playbook")` for our minimum acceptable
          → Apply Review workflow above
          → If 0 BLOCKERs, draft a "ready to sign" reply for CEO approval
          → If ≥1 BLOCKER, draft a redline reply with proposed alternatives, `request_approval(action: "send_external_redline", rationale: ...)`.

        See the difference? The good version is something the agent can ACT FROM.

        Output rules:
        - Return ONLY a single JSON object. No markdown fences. No prose before/after.
        - identity_md: 6–14 lines. Who the agent is, who they report to, what they own, what they explicitly don't.
        - personality_md: 5–10 lines. How they communicate. Tone, defaults, what they refuse to do. DO NOT include any banned phrases (synergy, leverage, robust, ecosystem, journey, holistic, paradigm, "circle back", "deep dive", "move the needle", "north star", "table stakes", "best in class", "world class", "mission critical") — not even as examples of phrases the agent avoids. Use OTHER concrete examples of corporate-speak to disavow if you need one.
        - instructions_md: 50–100+ lines of operating manual matching the GOOD example above. Markdown with `## Headers`. MUST include: at least one `## Example: …` scenario walk-through, named tool calls, concrete thresholds, what-they-don't-do, escalation rules.
        - email_signature_md: 3–5 lines. Closes the role's outbound email in the role's voice. MUST include the literal `{{agent_name}}` token. No "Best regards" / "Sincerely" boilerplate — use language that fits the role (e.g. an SDR's "— Sarah · SDR @ {{company_name}}" or a CFO's "{{agent_name}}, Finance · {{company_name}}").
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
          "suggested_integrations": ["service-name-1", "service-name-2"],   // MAX 6, MINIMUM VIABLE only — what the role can't do without. Skip "nice to haves".
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

    # Cap + dedupe + catalog-filter the AI's integration picks. Without
    # this the model overshoots wildly — a single SDR template returned
    # 21 integrations including QuickBooks, Jira, and Zendesk. We want
    # the minimum viable set, 6 max, only services we actually support.
    MAX_INTEGRATIONS = 6
    # Variants the AI tends to mix up — picks one canonical form. Right
    # side must be a slug that exists in ComposioSupported.all_toolkit_slugs.
    INTEGRATION_ALIASES = {
      "google-docs"     => "googledocs",
      "google_docs"     => "googledocs",
      "google-slides"   => "googleslides",
      "google_slides"   => "googleslides",
      "google-sheets"   => "googlesheets",
      "google_sheets"   => "googlesheets",
      "google-calendar" => "googlecalendar",
      "google_calendar" => "googlecalendar",
      "google-drive"    => "googledrive",
      "google_drive"    => "googledrive",
    }.freeze

    def self.sanitize_integrations(raw)
      catalog = begin
        ComposioSupported.all_toolkit_slugs.to_set
      rescue
        nil
      end
      slugs = Array(raw)
        .map { |s| s.to_s.downcase.strip }
        .reject(&:blank?)
        .map { |s| INTEGRATION_ALIASES[s] || s }
        .uniq
      slugs = slugs.select { |s| catalog.include?(s) } if catalog&.any?
      slugs.first(MAX_INTEGRATIONS)
    end

    def sanitize_integrations(raw) = self.class.sanitize_integrations(raw)

    def validate!(parsed)
      %w[slug name role identity_md personality_md instructions_md].each do |key|
        raise AnthropicClient::Error, "Missing required field: #{key}" if parsed[key].to_s.strip.empty?
      end
      parsed["slug"] = parsed["slug"].downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
      parsed["category"] = "starter" unless AgentTemplate::CATEGORIES.include?(parsed["category"].to_s)
      parsed["suggested_provider"] = (parsed["suggested_provider"].presence || "anthropic").to_s
      parsed["suggested_model"] = (parsed["suggested_model"].presence || "claude-sonnet-4-6").to_s
      parsed["suggested_skill_slugs"] = Array(parsed["suggested_skill_slugs"]).select { |s| @available_skills.include?(s) }
      parsed["suggested_integrations"] = sanitize_integrations(parsed["suggested_integrations"])
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
