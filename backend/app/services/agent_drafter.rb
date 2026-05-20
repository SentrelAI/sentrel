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
  MAX_TOKENS = 1200

  Result = Struct.new(:template_slug, :role, :skill_slugs, :capabilities,
                      :provider, :model_id, :name_suggestion, :reasoning,
                      :identity_md, :personality_md, :instructions_md, :generated,
                      keyword_init: true)

  def initialize(description:, tools_preference: "recommend", tools_description: nil,
                 templates: AgentTemplate.all.to_a, skills: SkillDefinition.all.to_a,
                 generate_fallback: true)
    @description = description.to_s.strip
    @tools_preference = tools_preference.to_s.presence || "recommend"
    @tools_description = tools_description.to_s.strip
    @templates = templates
    @skills = skills
    @generate_fallback = generate_fallback
  end

  def draft
    raw = call_anthropic
    parsed = parse_json(raw)
    result = build_result(parsed)
    maybe_generate_identity(result)
  rescue => e
    Rails.logger.warn "[AgentDrafter] LLM call failed: #{e.message} — falling back to heuristic"
    maybe_generate_identity(build_result(heuristic_match))
  end

  def to_h
    r = draft
    {
      template_slug: r.template_slug,
      role: r.role,
      skill_slugs: r.skill_slugs,
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
    http.read_timeout = 25

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
    template_lines = @templates.map { |t|
      "- #{t.slug} (#{t.role}): #{t.description.to_s.truncate(120)}"
    }.join("\n")
    skill_lines = @skills.map { |s|
      "- #{s.slug} (#{s.category}): #{s.description.to_s.truncate(100)}"
    }.join("\n")

    tool_pref = if @tools_preference == "specify" && @tools_description.present?
      "The user specified the tools they want to use:\n#{@tools_description}"
    else
      "The user wants you to recommend the best tools for the job."
    end

    <<~PROMPT
      You are helping a user create an AI agent. Based on the user's description
      below, pick the best-fit template, skills, and model. Return ONLY valid
      JSON, no markdown fences, no extra text.

      === USER DESCRIPTION ===
      #{@description}

      === TOOL PREFERENCE ===
      #{tool_pref}

      === AVAILABLE TEMPLATES ===
      #{template_lines.presence || '(none)'}

      === AVAILABLE SKILLS ===
      #{skill_lines.presence || '(none)'}

      === RESPONSE SHAPE ===
      {
        "template_slug": "<slug from AVAILABLE TEMPLATES, or null if none fit>",
        "role": "<short job title, e.g. 'Sales Development Rep'>",
        "skill_slugs": ["<slug from AVAILABLE SKILLS>", "..."],
        "capabilities": {
          "knowledge_base": true,
          "scheduling": true,
          "tasks": true,
          "integrations": true,
          "recall": true,
          "send_media": false
        },
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-6",
        "name_suggestion": "<single first name, e.g. 'Sarah'>",
        "reasoning": "<one sentence on why this template + skills fit>"
      }

      Rules:
      - template_slug MUST be one of the listed slugs or null. Do not invent slugs.
      - skill_slugs MUST be a subset of the listed skill slugs (use [] if none fit).
      - Pick claude-haiku-4-5-20251001 for simple/fast tasks (support, SDR triage),
        claude-sonnet-4-6 as the default, claude-opus-4-7 for heavy reasoning
        (CEO, engineering, research).
      - Enable capabilities only if the role plausibly needs them.
      - name_suggestion: a single human first name that fits the role's vibe.
    PROMPT
  end

  def parse_json(raw)
    json = raw.strip
    json = json.sub(/\A```(?:json)?\s*/, "").sub(/\s*```\z/, "") if json.start_with?("```")
    JSON.parse(json)
  rescue JSON::ParserError
    {}
  end

  def build_result(parsed)
    template_slug = parsed["template_slug"]
    template_slug = nil unless @templates.any? { |t| t.slug == template_slug }
    template = @templates.find { |t| t.slug == template_slug }

    skill_slugs = Array(parsed["skill_slugs"])
      .select { |s| @skills.any? { |sk| sk.slug == s } }
      .first(8)

    caps = (parsed["capabilities"] || {}).each_with_object({}) do |(k, v), h|
      next unless %w[knowledge_base scheduling tasks integrations recall send_media].include?(k.to_s)
      h[k.to_s] = { "enabled" => !!v }
    end
    caps = template.capabilities.deep_merge(caps) if template

    Result.new(
      template_slug: template&.slug,
      role: parsed["role"].presence || template&.role,
      skill_slugs: skill_slugs.presence || template&.suggested_skill_slugs || [],
      capabilities: caps,
      provider: parsed["provider"].presence || template&.suggested_provider || "anthropic",
      model_id: parsed["model_id"].presence || template&.suggested_model || "claude-sonnet-4-6",
      name_suggestion: parsed["name_suggestion"].presence,
      reasoning: parsed["reasoning"].presence,
      generated: false,
    )
  end

  # When no existing template fits and `generate_fallback` is on, call the
  # Forge::TemplateGenerator inline to draft a fresh identity_md /
  # personality_md / instructions_md from the user's free-text description.
  # The generated copy is returned in the result; the controller decides
  # whether to use it (typically: yes, since no template was picked).
  def maybe_generate_identity(result)
    return result if result.template_slug.present?
    return result unless @generate_fallback

    brief = {
      slug: nil,
      name: result.name_suggestion.presence || "Custom Agent",
      role: result.role.presence || "Custom",
      category: "starter",
      description: @description,
      notes: @tools_description.presence,
    }
    gen = Forge::TemplateGenerator.new(brief: brief, dry_run: true, available_skills: @skills.map(&:slug)).call
    return result unless gen.ok?

    t = gen.template
    result.identity_md     = t.identity_md
    result.personality_md  = t.personality_md
    result.instructions_md = t.instructions_md
    result.role            = (result.role.presence || t.role)
    result.skill_slugs     = (result.skill_slugs.presence || Array(t.suggested_skill_slugs))
    result.provider        = (result.provider.presence || t.suggested_provider)
    result.model_id        = (result.model_id.presence || t.suggested_model)
    result.generated       = true
    result
  rescue => e
    Rails.logger.warn "[AgentDrafter] identity generation failed: #{e.message}"
    result
  end

  # Tiny keyword-match fallback when the LLM is unreachable. Picks the
  # template whose name/role/description has the most word overlap with
  # the description; otherwise returns a bare result.
  def heuristic_match
    text = "#{@description} #{@tools_description}".downcase
    scored = @templates.map { |t|
      hay = "#{t.name} #{t.role} #{t.description}".downcase
      score = hay.scan(/\w+/).count { |w| w.length > 3 && text.include?(w) }
      [ t, score ]
    }.sort_by { |_, s| -s }
    best = scored.first&.last.to_i.positive? ? scored.first.first : nil
    {
      "template_slug" => best&.slug,
      "role" => best&.role,
      "skill_slugs" => best&.suggested_skill_slugs || [],
      "capabilities" => best&.capabilities || {},
      "provider" => best&.suggested_provider || "anthropic",
      "model_id" => best&.suggested_model || "claude-sonnet-4-6",
      "name_suggestion" => nil,
      "reasoning" => best ? "Closest template by keyword match." : "No clear template match."
    }
  end
end
