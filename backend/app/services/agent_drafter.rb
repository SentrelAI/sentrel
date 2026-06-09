require "net/http"
require "json"

# Maps a user's free-text description of an agent (and optional tool
# preferences) into a structured draft the new-agent form can pre-fill:
# best-fit template, role, suggested skills, capabilities, model, and a
# proposed name. Calls the Anthropic API; falls back to a heuristic match
# on errors so the UI never blocks.
class AgentDrafter
  ANTHROPIC_URL = URI.parse("https://api.anthropic.com/v1/messages").freeze
  MODEL = "claude-sonnet-4-6"
  # Bumped from 1200 to fit identity_md (~100 words) + personality_md
  # (~100 words) + instructions_md (~400 words structured playbook)
  # + the rest of the JSON envelope. ~2500 tokens at Sonnet 4.6's
  # ~80–120 tok/s lands ~20–25s — under the 35s frontend cap.
  MAX_TOKENS = 2500

  Result = Struct.new(:template_slug, :role, :skill_slugs, :capabilities,
                      :provider, :model_id, :name_suggestion, :reasoning,
                      :identity_md, :personality_md, :instructions_md, :generated,
                      keyword_init: true)

  # `templates` and `generate_fallback` are accepted for backward compat
  # with the agents_controller signature but no longer used — fresh-agent
  # drafting doesn't pick a template. The "Or start from a template →"
  # path on the wizard goes through a separate flow with explicit slug.
  def initialize(description:, tools_preference: "recommend", tools_description: nil,
                 templates: nil, skills: SkillDefinition.all.to_a, generate_fallback: false)
    @description = description.to_s.strip
    @tools_preference = tools_preference.to_s.presence || "recommend"
    @tools_description = tools_description.to_s.strip
    @skills = skills
  end

  def draft
    raw = call_anthropic
    parsed = parse_json(raw)
    build_result(parsed)
  rescue => e
    Rails.logger.warn "[AgentDrafter] LLM call failed: #{e.message} — returning empty draft so the wizard can fall back to a custom-shell form."
    build_result({})
  end

  def to_h
    r = draft
    {
      template_slug: r.template_slug,
      role: r.role,
      skill_slugs: r.skill_slugs,
      # Derive the integration list from the augmented skill set's
      # requires_connections. Single source of truth: whatever the
      # skills themselves declare they need. The form uses this for
      # the "Integrations to connect" display so the user sees the
      # right set instead of the template's stored (often stale) list.
      integration_slugs: integrations_for(r.skill_slugs),
      capabilities: r.capabilities,
      provider: r.provider,
      model_id: r.model_id,
      name_suggestion: r.name_suggestion,
      reasoning: r.reasoning,
      identity_md: r.identity_md,
      personality_md: r.personality_md,
      instructions_md: r.instructions_md,
      generated: r.generated,
    }
  end

  private

  def call_anthropic
    api_key = ENV["ANTHROPIC_API_KEY"]
    raise "ANTHROPIC_API_KEY is not set" unless api_key.present?

    http = Net::HTTP.new(ANTHROPIC_URL.host, ANTHROPIC_URL.port)
    http.use_ssl = true
    # 27s read timeout: enough for 2500 tokens of structured output from
    # Sonnet 4.6 (~18-25s at 80-120 tok/s) with a small safety margin.
    # Beyond 27s we abort and fall back to the heuristic — better to
    # return a skills-only draft than block the user with a 504.
    http.open_timeout = 5
    http.read_timeout = 27

    request = Net::HTTP::Post.new(ANTHROPIC_URL.path)
    request["Content-Type"] = "application/json"
    request["x-api-key"] = api_key
    request["anthropic-version"] = "2023-06-01"
    request.body = { model: MODEL, max_tokens: MAX_TOKENS,
                     messages: [ { role: "user", content: prompt } ] }.to_json

    response = http.request(request)
    body = JSON.parse(response.body)
    raise "Anthropic #{response.code}: #{body.dig('error', 'message')}" unless response.is_a?(Net::HTTPSuccess)
    body.dig("content", 0, "text").to_s
  end

  def prompt
    # Fresh-agent drafter — no template matching. The persona is generated
    # from scratch every time, so reaching into another template's prebaked
    # persona would just be inheriting somebody else's voice. Templates are
    # for the "Or start from a template →" path, not this one.
    skill_lines = @skills.map { |s|
      "- #{s.slug} (#{s.category}): #{s.description.to_s.truncate(100)}"
    }.join("\n")

    tool_pref = if @tools_preference == "specify" && @tools_description.present?
      "The user specified the tools they want to use:\n#{@tools_description}"
    else
      "The user wants you to recommend the best tools for the job."
    end

    <<~PROMPT
      You are creating a brand-new AI agent for the user from a free-text
      description. You will:

        (1) Pick the skills the role needs.
        (2) Pick a model that fits the role's complexity.
        (3) WRITE a fresh, opinionated persona (identity / personality /
            instructions) tuned to the SPECIFIC role the user described.
            The user wants an agent built for *their* company, *their* ICP,
            *their* anti-patterns — not a generic template copy.

      You will NOT pick a template. This is a fresh agent built from the
      description alone.

      Return ONLY valid JSON, no markdown fences, no extra text.

      === USER DESCRIPTION ===
      #{@description}

      === TOOL PREFERENCE ===
      #{tool_pref}

      === AVAILABLE SKILLS ===
      #{skill_lines.presence || '(none)'}

      === RESPONSE SHAPE ===
      {
        "role": "<REQUIRED — 2–4 word job title, e.g. 'Sales Development Rep', 'Customer Support Agent', 'Marketing Lead'>",
        "skill_slugs": ["<slug>", "..."],
        "capabilities": {
          "knowledge_base": true, "scheduling": true, "tasks": true,
          "integrations": true,  "recall": true,    "send_media": false
        },
        "provider": "anthropic",
        "model_id": "<model id>",
        "name_suggestion": "<single first name>",
        "reasoning": "<one sentence on the skills + model pick>",
        "identity_md": "<markdown — see rules>",
        "personality_md": "<markdown — see rules>",
        "instructions_md": "<markdown — see rules>"
      }

      === RULES ===

      Role: REQUIRED. Never leave blank or default to "Custom". Extract
      from the user's description — if they wrote "SDR for ScribeMD",
      the role is "Sales Development Rep". If "customer support agent for
      a SaaS", it's "Customer Support Agent". 2–4 words, title-cased.

      Skills:
      - 7–10 skills. Lean toward MORE, not fewer — a real role uses many.
      - INCLUDE the skill for every tool the user mentioned. HubSpot →
        hubspot-crm, Slack → slack-communication, Google Calendar →
        calendar-booking, Apollo → apollo-prospecting, Gmail →
        gmail-management.
      - INCLUDE role-essential skills even if not explicitly named. For an
        SDR: sdr-outreach + sdr-prospecting + send-email + web-search are
        all role-essential. For a writer: content-writing. For an
        engineer: code-review. Pick what the role actually needs.
      - MUST be a subset of AVAILABLE SKILLS slugs.

      Model:
      - claude-haiku-4-5-20251001 for high-volume / simple work.
      - claude-sonnet-4-6 as the default.
      - claude-opus-4-7 for deep reasoning, strategy, complex writing.

      identity_md (~100 words, first person, markdown):
      - Open with "I am {{agent_name}}, the <role> at {{company_name}}."
      - 3–5 short sentences about WHO this agent is and what they care about.
      - Reference specifics from the user's description: their company, their
        ICP, their pain point, the values they signaled.
      - End with one sentence about what this agent refuses to do (HIPAA
        constraints, brand boundaries, etc.) if the user mentioned them.

      personality_md (~100 words, first person, markdown):
      - How this agent communicates: tone, verbosity, formality level.
      - When this agent pushes back on a request vs. complies.
      - How this agent handles ambiguity (asks vs. drafts vs. escalates).
      - Quote the user's specific anti-patterns ("I never say 'just circling
        back'", "I never claim 100% accuracy", etc.) when they listed them.

      instructions_md (~400 words, markdown with H2 sections — all required):
      - ## How I work — 2–3 sentences on overall approach + the user's success metric.
      - ## Sequence / Workflow — the concrete steps for the typical task. For an
        SDR: the touch cadence. For support: the triage flow. For an analyst:
        the report-shipping rhythm. Be specific to the role described.
      - ## Tools — which skill to use when. Reference skill_slugs by name and
        explain when each fires ("for prospecting I use apollo-prospecting; for
        booking I use calendar-booking; ...").
      - ## When to escalate — explicit triggers. Quote the user's escalation
        rules verbatim if they gave any ("if a reply is hostile or off-topic,
        escalate to {{user_name}} on Slack instead of guessing").
      - ## Anti-patterns — bulleted list of things to NEVER do or say. Pull
        every "never" / "avoid" / "don't" from the user's description.
      - ## Success looks like — 1–2 sentences with the user's success metric
        verbatim if they gave one ("3–5 booked demos per week with ICP-fit
        prospects").

      Variables to USE LITERALLY (don't substitute): {{agent_name}},
      {{company_name}}, {{user_name}}, {{role}}.

      name_suggestion: a single human first name that fits the role's vibe.
    PROMPT
  end

  # Common ways users refer to integrations in plain English. Maps a
  # regex → the canonical integration slug it implies. Used to find the
  # integrations the user mentioned anywhere in their description, so
  # we can add the skills that depend on them. Keep small + explicit;
  # we'd rather miss a mention than misroute one (the prompt instruction
  # to Claude is the primary defense — this is the backstop for when it
  # misses an obvious one).
  INTEGRATION_NAME_PATTERNS = {
    "googlecalendar" => /\b(google\s+calendar|gcal)\b/i,
    "googledocs"     => /\bgoogle\s+docs?\b/i,
    "googlesheets"   => /\bgoogle\s+sheets?\b/i,
    "googledrive"    => /\bgoogle\s+drive\b/i,
  }.freeze

  # Walk the canonical seed data for any integration the user mentioned
  # in @description or @tools_description, and add ONE skill per matched
  # integration. Source of truth: db/seeds/skills frontmatter, not the
  # polluted DB rows. Picks the alphabetically first canonical skill
  # that requires that integration.
  def augment_skills_from_description(picked_slugs, template)
    haystack = "#{@description} #{@tools_description} #{template&.description}".downcase
    return picked_slugs if haystack.strip.empty?

    by_integration = Hash.new { |h, k| h[k] = [] }
    available = @skills.map(&:slug).to_set
    SkillDefinition.canonical_seed_data.each do |slug, data|
      next unless available.include?(slug)
      Array(data["requires_connections"]).each { |c| by_integration[c.to_s.downcase] << slug }
    end
    return picked_slugs if by_integration.empty?

    out = picked_slugs.dup
    by_integration.each do |integration, skill_slugs|
      pattern = INTEGRATION_NAME_PATTERNS[integration] || /\b#{Regexp.escape(integration)}\b/i
      next unless haystack =~ pattern
      candidate = skill_slugs.sort.first
      out << candidate unless out.include?(candidate)
    end
    out
  end

  MAX_INTEGRATIONS = 8

  # Source of truth for what each canonical skill REALLY needs to be
  # connected. The DB rows have been polluted on prod (Forge::Bootstrap
  # added bogus requires_connections like [linkedin, calendly, zoom]
  # to gmail-management), so we read from the immutable seed files
  # instead. Org-owned skills (not in canonical_seed_data) fall back
  # to whatever the DB row says.
  # Cheap fallback when Claude omits the role field — common acronyms
  # and role names extracted from the description. Title-cased. Better
  # than showing "Custom" to the user when the description clearly
  # names a role.
  ROLE_PATTERNS = {
    /\bSDR\b/i                         => "Sales Development Rep",
    /\bBDR\b/i                         => "Business Development Rep",
    /\bAE\b|\baccount executive\b/i    => "Account Executive",
    /\bsales development\b/i           => "Sales Development Rep",
    /\bcustomer success\b/i            => "Customer Success Manager",
    /\bcustomer support\b/i            => "Customer Support Agent",
    /\bmarketing (lead|manager)\b/i    => "Marketing Lead",
    /\bcontent (writer|strategist)\b/i => "Content Writer",
    /\bdata (analyst|scientist)\b/i    => "Data Analyst",
    /\b(software|backend|frontend) engineer\b/i => "Engineer",
    /\brecruiter\b/i                   => "Recruiter",
    /\bdesigner\b/i                    => "Designer",
    /\bresearcher\b/i                  => "Researcher",
    /\bCEO\b/i                         => "CEO",
    /\bCFO\b/i                         => "CFO",
    /\bCTO\b/i                         => "CTO",
  }.freeze

  def derive_role_from_description
    ROLE_PATTERNS.each { |pattern, role| return role if @description =~ pattern }
    nil
  end

  # Skills that any agent in this role family realistically needs, even
  # when the user doesn't name them by slug. The augmentation pass
  # before this only catches skills tied to an integration mention —
  # skills like sdr-outreach + web-search + send-email have no
  # requires_connections, so they only get added if Claude picks them
  # OR if we inject them here. Pattern matches against the FULL
  # description (not just role keywords), so users get the right
  # baseline even when phrasing is loose.
  ROLE_ESSENTIAL_SKILLS = {
    /\b(SDR|sales development|BDR|business development|outbound sales)\b/i =>
      %w[sdr-outreach sdr-prospecting send-email web-search],
    /\bAE\b|\baccount executive\b/i =>
      %w[sdr-outreach hubspot-crm calendar-booking web-search],
    /\bcustomer (support|service)\b/i =>
      %w[gmail-management slack-communication web-search],
    /\bcustomer success\b/i =>
      %w[gmail-management calendar-booking hubspot-crm web-search],
    /\bmarketing (lead|manager|specialist)\b/i =>
      %w[content-writing social-media send-email web-search],
    /\bcontent (writer|strategist|specialist)\b/i =>
      %w[content-writing web-search send-files],
    /\brecruiter\b/i =>
      %w[gmail-management calendar-booking web-search],
    /\b(software|backend|frontend|web) (engineer|developer)\b/i =>
      %w[code-review web-dev web-search],
    /\bdesigner\b/i =>
      %w[web-search send-files],
    /\bresearcher\b/i =>
      %w[web-search send-files],
    /\bdata (analyst|scientist)\b/i =>
      %w[web-search send-files],
    /\bCEO\b|\bchief executive\b/i =>
      %w[web-search send-email],
    /\bCFO\b|\bchief financial\b/i =>
      %w[expense-tracking web-search],
    /\bCTO\b|\bchief technology\b/i =>
      %w[code-review web-search],
    /\bproduct manager\b|\bPM\b/i =>
      %w[web-search send-files],
  }.freeze

  def inject_role_essentials(picked_slugs)
    available = @skills.map(&:slug).to_set
    out = picked_slugs.dup
    ROLE_ESSENTIAL_SKILLS.each do |pattern, essentials|
      next unless @description =~ pattern
      essentials.each do |slug|
        next unless available.include?(slug)
        out << slug unless out.include?(slug)
      end
    end
    out
  end

  def integrations_for(skill_slugs)
    slugs = Array(skill_slugs)
    return [] if slugs.empty?
    seed = SkillDefinition.canonical_seed_data
    skill_index = @skills.index_by(&:slug)
    slugs.flat_map { |slug|
      seed[slug]&.dig("requires_connections") ||
        Array(skill_index[slug]&.requires_connections)
    }
      .map { |s| s.to_s.downcase.strip }
      .reject(&:blank?)
      .uniq
      .first(MAX_INTEGRATIONS)
  end

  def parse_json(raw)
    json = raw.strip
    json = json.sub(/\A```(?:json)?\s*/, "").sub(/\s*```\z/, "") if json.start_with?("```")
    JSON.parse(json)
  rescue JSON::ParserError
    {}
  end

  # Sensible defaults for a real agent. send_media off because most
  # roles don't need voice/image/file output; everything else on
  # because they're broadly useful (search history, set reminders,
  # use Composio integrations, delegate tasks). Claude's response can
  # override any individual key — but if Claude omits or returns false
  # on something the role plausibly needs, we don't silently disable
  # a useful capability.
  CAPABILITY_DEFAULTS = {
    "knowledge_base" => true,
    "scheduling"     => true,
    "tasks"          => true,
    "integrations"   => true,
    "recall"         => true,
    "send_media"     => false,
  }.freeze

  def build_result(parsed)
    picked = Array(parsed["skill_slugs"]).select { |s| @skills.any? { |sk| sk.slug == s } }
    # Two-stage deterministic backstop:
    #   (1) augment_skills_from_description — adds a skill for every
    #       integration the user named (HubSpot → hubspot-crm, etc.)
    #   (2) inject_role_essentials — adds the no-integration-tagged
    #       role-essential skills (sdr-outreach, send-email, web-search
    #       for an SDR) that the augmentation pass can't catch because
    #       they have no requires_connections.
    picked = augment_skills_from_description(picked, nil)
    picked = inject_role_essentials(picked).first(12)

    # Capabilities: start from defaults, let Claude override individual
    # keys. Avoids the "all checkboxes off" outcome when Claude omits
    # the field or returns conservative falses.
    raw_caps = parsed["capabilities"] || {}
    caps = CAPABILITY_DEFAULTS.each_with_object({}) do |(k, default), h|
      v = raw_caps[k]
      enabled = v.is_a?(Hash) ? !!v["enabled"] : (v.nil? ? default : !!v)
      h[k] = { "enabled" => enabled }
    end

    Result.new(
      template_slug:   nil,  # fresh agent — no template lineage
      role:            parsed["role"].presence || derive_role_from_description,
      skill_slugs:     picked,
      capabilities:    caps,
      provider:        parsed["provider"].presence || "anthropic",
      model_id:        parsed["model_id"].presence || "claude-sonnet-4-6",
      name_suggestion: parsed["name_suggestion"].presence,
      reasoning:       parsed["reasoning"].presence,
      identity_md:     parsed["identity_md"].presence,
      personality_md:  parsed["personality_md"].presence,
      instructions_md: parsed["instructions_md"].presence,
      generated:       parsed["identity_md"].present?,
    )
  end

end
