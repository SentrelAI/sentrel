# Deploys a validated agent-bundle/v1 Manifest as a LIVE Agent in the
# org — the server half of "npx agentmanifest deploy" / "install from
# GitHub". Persona markdown lands verbatim, skills upsert as org
# SkillDefinitions (slug-collision fork, same policy as
# AgentTemplates::Importer), channels provision pending rows, and the
# goal block is appended to instructions so the engine's system prompt
# carries the mission + KPIs.
#
#   result = AgentBundles::Deployer.new(
#     manifest: manifest, user: current_user, organization: current_tenant,
#   ).call
#   result.agent      # saved Agent (caller fires EngineSync + ProvisionAgentJob)
#   result.notices    # ["Connect apollo at /integrations", "Add secret APOLLO_API_KEY", ...]
#
# Returns the Agent unsaved-side-effects-free beyond DB rows: the caller
# decides about provisioning jobs, exactly like AgentTemplates::Installer.
module AgentBundles
  class Deployer
    Result = Struct.new(:agent, :notices, keyword_init: true)

    # bundle verb → our permission level
    PERMISSION_MAP = { "ask" => "draft", "auto" => "auto", "block" => "never" }.freeze

    # Overrides come from the deploy wizard — everything the user edited
    # before clicking Deploy wins over the bundle's values. Persona
    # overrides may still contain {{tokens}}; substitution happens after
    # the merge so edited text gets the same variable treatment.
    def initialize(manifest:, user:, organization:, name: nil, slug: nil,
                   role: nil, model: nil, goal: nil, persona: nil,
                   schedules: nil, platform_skill_slugs: nil,
                   integration_choices: nil, inputs: nil, permissions: nil)
      @m = manifest
      @user = user
      @org = organization
      @name_override = name.to_s.strip.presence
      @slug_override = slug.to_s.strip.presence
      @role_override = role.to_s.strip.presence
      @model_override = model.is_a?(Hash) ? model.compact_blank : {}
      @goal_override = goal.is_a?(Hash) ? goal : nil
      @persona_override = persona.is_a?(Hash) ? persona : {}
      # nil → use the bundle's schedules untouched; an array (possibly
      # empty) → the wizard's edited list replaces them entirely.
      @schedules_override = schedules.is_a?(Array) ? schedules : nil
      # Extra PLATFORM skills the user ticked in the wizard — canonical
      # seeds only, looked up by slug at install.
      @platform_skill_slugs = Array(platform_skill_slugs).map(&:to_s).reject(&:blank?).uniq
      # For any_of integration groups: the service the user picked per
      # group in the wizard. Drives the connect-next notices.
      @integration_choices = Array(integration_choices).map(&:to_s).reject(&:blank?).uniq
      # Per-verb permission levels tuned in the wizard's Boundaries step.
      # Only known verbs (from the bundle) with valid levels are honored.
      @permissions_override = permissions.is_a?(Hash) ? permissions : {}
      # Deploy-time input values (bundle `inputs:` declarations) — extra
      # {{key}} substitution targets, e.g. github_repos for a bug-fixer.
      @inputs = inputs.is_a?(Hash) ? inputs.transform_keys(&:to_s).transform_values(&:to_s) : {}
      @notices = []
    end

    def call
      agent = nil
      ActsAsTenant.with_tenant(@org) do
        Agent.transaction do
          agent = build_agent
          agent.save!
          create_ai_config!(agent)
          install_skills!(agent)
          create_channels!(agent)
          create_schedules!(agent)
          create_webhooks!(agent)
        end
      end
      ingest_knowledge(agent) # outside the transaction — engine call, best-effort
      collect_notices
      Result.new(agent: agent, notices: @notices)
    end

    private

    def build_agent
      name = @name_override || @m.name
      slug = unique_agent_slug(@slug_override || name)
      goal_section = render_goal_section
      ctx = substitution_context(name)
      @org.agents.build(
        name: name,
        slug: slug,
        role: effective_role,
        identity_md:     substitute(persona_value("identity"), ctx),
        personality_md:  substitute(persona_value("personality"), ctx),
        instructions_md: substitute([ persona_value("instructions"), goal_section ].compact.join("\n\n"), ctx),
        permissions: mapped_permissions,
      )
    end

    def effective_role
      @role_override || @m.role.presence || "Agent"
    end

    # Wizard-edited markdown wins over the bundle's file. nil/blank
    # override → fall back to the bundle.
    def persona_value(key)
      @persona_override[key].presence || @persona_override[key.to_sym].presence || @m.persona_md(key)
    end

    # Wizard-edited goal wins. An override with a blank mission means the
    # user cleared the goal — render nothing.
    def effective_goal
      return @m.goal if @goal_override.nil?
      @goal_override["mission"].presence || @goal_override[:mission].presence ? @goal_override : nil
    end

    # Same {{token}} substitution AgentTemplates::Installer does, plus
    # {{company_domain}} (bundles use it for email-address hints). Unknown
    # tokens are LEFT IN PLACE — visible in the editor beats silently
    # replaced with an empty string.
    def substitution_context(agent_name)
      # Bundle input defaults < wizard-provided values < built-ins. The
      # built-ins go last so a bundle can't shadow agent_name/user_email
      # by declaring an input with the same key.
      defaults = @m.inputs.each_with_object({}) { |i, h| h[i["key"].to_s] = i["default"].to_s if i["default"].present? }
      defaults
        .merge(@inputs.reject { |_, v| v.blank? })
        .merge({
          "agent_name"     => agent_name,
          "company_name"   => @org.name,
          "user_name"      => @user.try(:name).presence || @user.try(:email),
          "user_email"     => @user.try(:email).presence,
          "role"           => effective_role,
          "company_domain" => @org.try(:email_domain).presence
        }.compact)
    end

    def valid_timezone?(tz)
      TZInfo::Timezone.get(tz)
      true
    rescue TZInfo::InvalidTimezoneIdentifier
      false
    end

    def substitute(text, ctx)
      return nil if text.blank?
      text.gsub(/\{\{\s*(\w+)\s*\}\}/) { ctx.key?(Regexp.last_match(1)) ? ctx[Regexp.last_match(1)] : Regexp.last_match(0) }
    end

    # goal: {mission:, kpis: [{k => v}], definition_of_done:} → a markdown
    # section appended to instructions_md so the engine's system prompt
    # carries it without needing a new column or prompt-builder change.
    def render_goal_section
      g = effective_goal&.stringify_keys
      return nil unless g
      lines = [ "## Goal", "", g["mission"].to_s.strip ]
      kpis = Array(g["kpis"]).filter_map { |kpi| kpi.is_a?(Hash) ? kpi.stringify_keys.first : nil }
      if kpis.any?
        lines << "" << "KPIs:"
        kpis.each { |k, v| lines << "- #{k.to_s.tr('_', ' ')}: #{v}" }
      end
      if g["definition_of_done"].present?
        lines << "" << "Definition of done: #{g['definition_of_done'].to_s.strip}"
      end
      lines.join("\n")
    end

    def mapped_permissions
      allowed_levels = (PERMISSION_MAP.keys + PERMISSION_MAP.values).to_set
      @m.permissions.each_with_object({}) do |(verb, level), h|
        chosen = @permissions_override[verb.to_s].to_s
        effective = allowed_levels.include?(chosen) ? chosen : level.to_s
        h[verb.to_s] = PERMISSION_MAP[effective] || effective
      end
    end

    def create_ai_config!(agent)
      cfg = @m.model.merge(@model_override.stringify_keys)
      provider = cfg["provider"].presence || "anthropic"
      # Prefer the org's connected Claude subscription over a metered API key,
      # mirroring AgentTemplates::Installer + the in-app create path. Without
      # this, every agent deployed via the deploy-agent / bundle flow stuck on
      # the platform API key even when the org had the subscription connected.
      if provider.to_s == "anthropic" && org_has_anthropic_oauth?(agent.organization_id)
        provider = "anthropic_account"
      end
      agent.create_ai_config!(
        provider:       provider,
        model_id:       (cfg["model_id"] || cfg["id"]).presence || "claude-sonnet-4-6",
        temperature:    cfg["temperature"] || 0.7,
        max_tokens:     cfg["max_tokens"] || 8192,
        thinking_level: cfg["thinking_level"].presence || "none",
      )
    end

    def org_has_anthropic_oauth?(org_id)
      OauthCredential.exists?(organization_id: org_id, provider: "anthropic", kind: "ai_provider")
    rescue StandardError
      false
    end

    # Same collision policy as AgentTemplates::Importer: reuse an
    # equivalent org skill, fork a conflicting one to <slug>-imported-<n>,
    # create verbatim otherwise. Wizard-ticked platform skills install
    # first — straight slug lookups against canonical seeds + org skills,
    # no file content involved.
    def install_skills!(agent)
      install_platform_skills!(agent)
      @m.skill_bundles.each do |bundle|
        slug = sanitize_slug(bundle[:slug])
        next if slug.blank? || bundle[:files]["SKILL.md"].blank?
        skill = resolve_or_create_skill(slug, bundle[:files])
        agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
      end
    end

    def install_platform_skills!(agent)
      @platform_skill_slugs.each do |slug|
        skill = SkillDefinition.where(slug: slug)
                               .where("organization_id = ? OR organization_id IS NULL", @org.id)
                               .first
        if skill
          agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
        else
          @notices << "Platform skill #{slug} isn't available on this instance — skipped."
        end
      end
    end

    # Reuse-or-fork resolution for one bundle skill: reuse a content-equal
    # org/platform skill, otherwise create.
    def resolve_or_create_skill(slug, files)
      existing = SkillDefinition.where(slug: slug)
                                .where("organization_id = ? OR organization_id IS NULL", @org.id)
                                .first
      # The reuse-lookup above is scoped to (this org OR platform), but
      # SkillDefinition slugs are GLOBALLY unique — another org may own
      # the slug. available_slug forks the name in that case, otherwise
      # cross-org deploys of the same bundle fail with "Slug has
      # already been taken" for every org after the first.
      if existing.nil?
        create_skill!(available_slug(slug), files)
      elsif existing.skill_md.to_s.strip == files["SKILL.md"].to_s.strip
        existing
      else
        create_skill!(unique_skill_slug(slug), files)
      end
    end

    def create_skill!(slug, files)
      md = files["SKILL.md"]
      meta = parse_frontmatter(md)
      record = SkillDefinition.create!(
        organization_id: @org.id,
        slug: slug,
        name: meta["name"].presence || slug.humanize,
        description: meta["description"],
        category: meta["category"].presence || "common",
        source: "imported",
        visibility: "private",
        published: true,
        requires_connections: Array(meta["requires_connections"]),
        skill_md: md,
      )
      files.each_with_index do |(path, content), pos|
        record.skill_files.create!(
          path: path, content: content, position: pos,
          file_type: File.extname(path).delete_prefix(".").presence || "md",
        )
      end
      record
    end

    # Standing cron jobs declared in the bundle (schedules[]) become
    # ScheduledWork rows — the agent wakes up and runs its routine
    # (morning sweeps, weekly digests) from day one. Instructions get
    # the same {{token}} substitution as persona text. Per-thread
    # one-shot reminders are NOT bundled — the agent creates those at
    # runtime via its scheduling tools.
    def create_schedules!(agent)
      ctx = substitution_context(agent.name)
      schedule_list.each do |sched|
        s = sched.respond_to?(:stringify_keys) ? sched.stringify_keys : sched
        next if s["name"].blank? || s["cron"].blank? || s["instruction"].blank?
        # Timezone gets the same {{token}} substitution as the instruction —
        # bundles declare `timezone: "{{timezone}}"` against a deploy input.
        # Unresolved tokens / junk fall back to UTC rather than reaching the
        # engine's cron parser as an invalid zone.
        tz = substitute(s["timezone"].presence || "UTC", ctx)
        tz = "UTC" if tz.blank? || tz.include?("{{") || !valid_timezone?(tz)
        agent.scheduled_work.create!(
          organization: @org,
          mode: "cron",
          name: s["name"],
          instruction: substitute(s["instruction"], ctx),
          cron_expression: s["cron"],
          timezone: tz,
          active: true,
        )
      end
    end

    def schedule_list
      @schedules_override.nil? ? @m.schedules : @schedules_override
    end

    # Bundle-declared inbound webhook endpoints — each gets a fresh token
    # at deploy. The URLs live on the agent's Webhooks tab; the notice
    # below points the user there to wire up Sentry/GitHub/Linear.
    def create_webhooks!(agent)
      ctx = substitution_context(agent.name)
      @m.webhooks.each do |w|
        agent.agent_webhooks.create!(
          organization: @org,
          name: w["name"],
          source: AgentWebhook::SOURCES.include?(w["source"].to_s) ? w["source"] : "generic",
          instruction: substitute(w["instruction"], ctx),
          active: true,
        )
      end
      if @m.webhooks.any?
        @notices << "#{@m.webhooks.size} webhook URL#{'s' if @m.webhooks.size > 1} created — copy from the Webhooks tab into #{@m.webhooks.filter_map { |w| w['source'] }.uniq.join('/').presence || 'your services'}."
      end
    end

    def create_channels!(agent)
      @m.channels.each do |ch|
        type = ch["type"].to_s
        next if agent.channel_configs.exists?(channel_type: type)
        cfg = {}
        status = "pending"
        enabled = false
        if type == "email"
          domain = @org.try(:email_domain).presence
          if domain
            cfg["address"] = "#{agent.slug}@#{domain}"
            status = "connected"
            enabled = true
          else
            @notices << "Set a workspace email domain in Settings, then connect the email channel."
            next
          end
        end
        agent.channel_configs.create!(channel_type: type, enabled: enabled, status: status, config: cfg)
        @notices << "Finish connecting the #{type} channel on the agent's Channels tab." unless enabled
      end
    end

    # Knowledge docs ship in the bundle; ingest each into the engine's RAG
    # store for this agent. Engine may still be provisioning — failures are
    # collected as notices, not raised, so deploy never fails on this.
    def ingest_knowledge(agent)
      docs = @m.knowledge_docs
      return if docs.empty?
      ctx = substitution_context(agent.name)
      docs.each do |doc|
        engine_request(Net::HTTP::Post, "/rag/ingest",
          body: { agent_id: agent.id, title: doc[:path], content: substitute(doc[:content], ctx) })
      rescue => e
        Rails.logger.warn "[AgentBundles::Deployer] knowledge ingest #{doc[:path]} failed: #{e.message}"
        @notices << "Knowledge doc #{doc[:path]} couldn't be ingested yet — upload it on the Knowledge tab once the agent is running."
      end
    end

    def engine_request(method, path, body: nil)
      base = ENV.fetch("ENGINE_URL", "http://localhost:3300")
      uri = URI.parse("#{base}#{path}")
      req = method.new(uri, { "Content-Type" => "application/json", "X-Engine-Secret" => ENV["ENGINE_API_SECRET"].to_s })
      req.body = body.to_json if body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", open_timeout: 2, read_timeout: 15) { |h| h.request(req) }
      raise "HTTP #{res.code}" unless res.is_a?(Net::HTTPSuccess)
      res
    end

    def collect_notices
      # Plain services + the user's pick from each any_of group. Groups
      # with no pick (e.g. JSON API deploys) fall back to the first
      # alternative so the notice still names something actionable.
      services = @m.integrations.filter_map { |i| i["service"] }
      @m.integrations.select { |i| i["any_of"].is_a?(Array) }.each do |group|
        options = group["any_of"].map(&:to_s)
        if group["multi"]
          # Multi: the agent uses every connected option; none is
          # individually required, so only surface the ones the user
          # explicitly chose/connected (the connected filter below drops
          # the rest). Don't fall back to "first" — that would nag about
          # a network the brand may not even use.
          services.concat(@integration_choices & options)
        else
          chosen = (@integration_choices & options).first
          services << (chosen || options.first)
        end
      end
      # Don't nag about services the org already has connected. Compare on
      # a normalized form — integration slugs ("googlecalendar") and stored
      # service_names ("google_calendar", "GOOGLECALENDAR") drift in
      # casing/separators depending on which surface created the row.
      connected = @org.integrations.where(status: "connected")
                      .pluck(:service_name)
                      .map { |s| normalize_service(s) }
                      .to_set
      services = services.uniq.reject { |s| connected.include?(normalize_service(s)) }
      @notices << "Connect at /integrations: #{services.join(', ')}" if services.any?
      mcp = @m.integrations.select { |i| i["type"] == "mcp" }.filter_map { |i| i["name"] }
      @notices << "MCP integrations aren't supported yet (skipped): #{mcp.join(', ')}" if mcp.any?
      @notices << "Add secrets at /settings/credentials: #{@m.secret_names.join(', ')}" if @m.secret_names.any?
    end

    # "google_calendar" / "Google-Calendar" / "GOOGLECALENDAR" → "googlecalendar"
    def normalize_service(s)
      s.to_s.downcase.gsub(/[^a-z0-9]/, "")
    end

    def sanitize_slug(s)
      s.to_s.downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
    end

    def unique_agent_slug(name)
      base = sanitize_slug(name).presence || "agent"
      candidate = base
      n = 1
      while @org.agents.exists?(slug: candidate)
        n += 1
        candidate = "#{base}-#{n}"
      end
      candidate
    end

    def unique_skill_slug(base)
      n = 1
      loop do
        candidate = "#{base}-imported-#{n}"
        return candidate unless SkillDefinition.exists?(slug: candidate)
        n += 1
        return "#{base}-imported-#{SecureRandom.hex(2)}" if n > 50
      end
    end

    # The slug itself if no row anywhere holds it (slugs are globally
    # unique), else a forked name.
    def available_slug(slug)
      SkillDefinition.exists?(slug: slug) ? unique_skill_slug(slug) : slug
    end

    def parse_frontmatter(md)
      m = md.to_s.match(/\A---\n(.*?)\n---/m)
      return {} unless m
      YAML.safe_load(m[1]) || {}
    rescue Psych::SyntaxError
      {}
    end
  end
end
