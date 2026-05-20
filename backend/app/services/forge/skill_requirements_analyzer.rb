module Forge
  # Step 1 of skills-first template generation.
  #
  # Takes a role brief and asks Claude: "what specific capabilities does
  # this role need to do its job?" The answer is a list of *semantic*
  # requirements — "send and read Gmail", "post to Slack channels",
  # "manage Google Calendar", "search the web" — NOT specific slugs.
  #
  # The SkillResolver then maps each requirement to a real SkillDefinition
  # (local match → skills.sh → GitHub → generate), so the template ends up
  # constrained to a known set of real slugs before TemplateGenerator
  # writes its suggested_skill_slugs.
  class SkillRequirementsAnalyzer
    Requirement = Struct.new(:capability, :query, :priority, :rationale, :composio_toolkit, keyword_init: true)

    # The 50-or-so curated slugs from ComposioSupported::CATEGORY_MAP, shown
    # as well-known examples in the prompt to anchor Claude on the common
    # cases (gmail, slack, salesforce, ...). Tight prompt, big signal.
    EXAMPLE_TOOLKITS = ComposioSupported::CATEGORY_MAP.keys.freeze

    def initialize(brief:, model: AnthropicClient::DEFAULT_MODEL, max_count: 10)
      @brief = brief.is_a?(Hash) ? brief : { description: brief.to_s }
      @model = model
      @max_count = max_count
    end

    # The FULL Composio catalog (1000+ slugs) as the validation set. If
    # Claude picks "convertkit" or "intercom" and that slug exists on
    # Composio, we accept it — we just don't list every long-tail slug in
    # the prompt. Memoized at the class level so 109 parallel analyzers
    # share the lookup.
    def self.valid_toolkit_set
      @valid_toolkit_set ||= ComposioSupported.all_toolkit_slugs.to_set
    end

    def self.reset_valid_toolkit_cache!
      @valid_toolkit_set = nil
    end

    def call
      raw = AnthropicClient.complete(prompt: build_prompt, model: @model, max_tokens: 1500, system: system_prompt)
      parsed = AnthropicClient.parse_json(raw)
      Array(parsed["requirements"]).first(@max_count).map { |r| build_requirement(r) }.compact
    rescue => e
      # Log loudly + RAISE so TemplatePack surfaces a meaningful error in
      # the Bootstrap summary instead of "requirements analyzer returned
      # nothing" which buries the actual cause (auth failure, 400 from
      # API, version mismatch, etc.).
      Rails.logger.error "[SkillRequirementsAnalyzer] #{@brief[:slug] || @brief[:name]} failed: #{e.class}: #{e.message}"
      raise
    end

    private

    def build_requirement(r)
      capability = r["capability"].to_s.strip
      return nil if capability.empty?
      toolkit = r["composio_toolkit"].to_s.downcase.presence
      toolkit = nil unless toolkit.nil? || self.class.valid_toolkit_set.include?(toolkit)
      Requirement.new(
        capability: capability,
        query: (r["query"].presence || capability.downcase.tr("^a-z0-9 ", " ").squeeze(" ")).strip,
        priority: %w[required nice_to_have].include?(r["priority"].to_s) ? r["priority"] : "required",
        rationale: r["rationale"].to_s,
        composio_toolkit: toolkit,
      )
    end

    def system_prompt
      <<~SYS
        You analyze agent role briefs to identify the discrete capabilities the agent needs to do its job.

        Rules:
        - Output 3–10 requirements per role. Required first, nice-to-have last.
        - Each requirement is ONE concrete capability — "send email via Gmail" not "communication".
        - Requirements describe verbs + objects, not job functions. ("post to Slack channels", not "team communications").
        - DO NOT name skill slugs. Just describe the capability.
        - For each, provide a short search query (3-6 words) the resolver will use to find an existing SKILL.md.
        - Mark priority: "required" or "nice_to_have".
        - Map each capability to a Composio toolkit slug when it talks to an external SaaS (Gmail, Slack, Salesforce, etc.). Use null when the capability is local/internal (e.g. "summarize a transcript", "render PDF") OR uses a non-Composio service.
        - Composio publishes 1000+ toolkit slugs. Common examples (exact spelling required):
          #{EXAMPLE_TOOLKITS.each_slice(8).map { |s| s.join(", ") }.join("\n          ")}
        - For less common SaaS (convertkit, beehiiv, square, etc.) you may use any Composio toolkit slug you're confident exists — we validate against the live catalog and silently set it to null if the slug doesn't exist.
        - Return ONLY a JSON object, no fences.
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

        === RESPONSE SHAPE ===
        {
          "requirements": [
            {
              "capability": "send and reply to email via Gmail",
              "query": "send gmail email",
              "priority": "required",
              "composio_toolkit": "gmail",
              "rationale": "Most of this role's day-to-day output ships via email."
            },
            {
              "capability": "summarize a meeting transcript into action items",
              "query": "meeting summary action items",
              "priority": "required",
              "composio_toolkit": null,
              "rationale": "Local processing — no external SaaS involved."
            },
            ...up to #{@max_count} entries
          ]
        }
      PROMPT
    end
  end
end
