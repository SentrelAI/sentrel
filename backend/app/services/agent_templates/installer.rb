module AgentTemplates
  # Install a portable agent.json definition into the current org as a new
  # Agent. Same code path covers:
  #   - Install from an AgentTemplateVersion (most common — community pick)
  #   - Install from a raw JSON paste (advanced — power user)
  #
  #   AgentTemplates::Installer.new(
  #     definition:    template.current_version.definition,
  #     agent_attrs:   { name: "Casper", slug: "casper", role: nil },
  #     ai_config_attrs: { provider: "anthropic", model_id: nil },
  #     user: current_user, organization: current_tenant,
  #   ).call
  #   # => Agent (saved, ai_config created, skills installed)
  #
  # Returns the Agent (saved + provisioned-but-not-yet-booted). Caller is
  # responsible for triggering ProvisionAgentJob + the integration-missing
  # callout. The service intentionally doesn't fire those side effects so
  # specs + bulk-install paths can drive it without surprise jobs.
  class Installer
    class InvalidDefinition < StandardError; end

    def initialize(definition:, agent_attrs:, ai_config_attrs: {}, user:, organization:,
                   prefer_anthropic_oauth: false)
      @definition       = definition.is_a?(Hash) ? definition.deep_stringify_keys : (raise InvalidDefinition, "definition must be a Hash")
      @agent_attrs      = agent_attrs.to_h.symbolize_keys
      @ai_config_attrs  = ai_config_attrs.to_h.symbolize_keys
      @user             = user
      @organization     = organization
      @prefer_anthropic_oauth = prefer_anthropic_oauth
    end

    def call
      ActsAsTenant.with_tenant(@organization) do
        Agent.transaction do
          agent = build_agent
          apply_persona!(agent)
          apply_capabilities!(agent)
          apply_spend_caps!(agent)
          agent.save!
          create_ai_config!(agent)
          install_skills!(agent)
          install_approval_rules!(agent)
          agent
        end
      end
    end

    private

    def build_agent
      attrs = {
        name: @agent_attrs[:name],
        slug: @agent_attrs[:slug],
        role: @agent_attrs[:role].presence || @definition["role"],
      }
      attrs[:manager_id] = @agent_attrs[:manager_id] if @agent_attrs.key?(:manager_id)
      # Pre-set persona fields from the caller's @agent_attrs so
      # apply_persona!'s `||=` skips the template substitution when the
      # caller supplies its own markdown. Caller can pass nil/empty to
      # fall back to the template's persona — only present strings win.
      attrs[:identity_md]     = @agent_attrs[:identity_md]     if @agent_attrs[:identity_md].present?
      attrs[:personality_md]  = @agent_attrs[:personality_md]  if @agent_attrs[:personality_md].present?
      attrs[:instructions_md] = @agent_attrs[:instructions_md] if @agent_attrs[:instructions_md].present?
      @organization.agents.build(attrs)
    end

    # Substitute {{agent_name}}, {{company_name}}, {{user_name}},
    # {{user_email}}, {{role}} in the persona md fields the same way
    # AgentTemplate#render did.
    def apply_persona!(agent)
      ctx = {
        "agent_name"   => agent.name,
        "company_name" => @organization.name,
        "user_name"    => @user.name,
        "user_email"   => @user.try(:email),
        "role"         => agent.role,
      }.compact
      persona = @definition["persona"] || {}
      agent.identity_md       ||= substitute(persona["identity_md"], ctx)
      agent.personality_md    ||= substitute(persona["personality_md"], ctx)
      agent.instructions_md   ||= substitute(persona["instructions_md"], ctx)
      agent.email_signature_md ||= substitute(persona["email_signature_md"], ctx)
    end

    def substitute(text, ctx)
      return nil if text.blank?
      text.to_s.gsub(/\{\{\s*(\w+)\s*\}\}/) { ctx[Regexp.last_match(1)] || "" }
    end

    def apply_capabilities!(agent)
      caps = @definition["capabilities"] || {}
      return if caps.empty?
      agent.capabilities = caps.deep_merge(agent.capabilities || {})
    end

    def apply_spend_caps!(agent)
      caps = @definition["spend_caps"] || {}
      agent.spend_daily_cap_usd       = caps["daily_usd"]            if caps["daily_usd"]
      agent.spend_monthly_cap_usd     = caps["monthly_usd"]          if caps["monthly_usd"]
      agent.spend_notify_threshold_pct = caps["notify_threshold_pct"] if caps["notify_threshold_pct"]
    rescue ActiveModel::MissingAttributeError
      # Agent model doesn't have spend cap columns — silently skip.
    end

    def create_ai_config!(agent)
      defaults = @definition["model"] || {}
      cfg = {
        provider:       (@ai_config_attrs[:provider].presence || defaults["provider"]),
        model_id:       (@ai_config_attrs[:model_id].presence || defaults["model_id"]),
        temperature:    (@ai_config_attrs[:temperature]      || defaults["temperature"]),
        max_tokens:     (@ai_config_attrs[:max_tokens]       || defaults["max_tokens"]),
        thinking_level: (@ai_config_attrs[:thinking_level].presence || defaults["thinking_level"]),
      }.compact
      # Prefer the org's Claude OAuth subscription over the platform key
      # for bare "anthropic" picks. Caller toggles this — agents_controller
      # passes true; programmatic installs pass false.
      cfg[:provider] = "anthropic_account" if @prefer_anthropic_oauth && cfg[:provider].to_s == "anthropic"
      agent.create_ai_config!(cfg)
    end

    # Install every skill the definition references. Three entry shapes:
    #
    #   - source: "platform" → look up the seeded built-in by slug; link
    #     to it. If missing on this instance (e.g. older Alchemy build),
    #     log + skip; no embed-fallback because platform skills are
    #     intentionally not bundled in the definition.
    #
    #   - source: "custom" with files → upsert the embedded bundle into
    #     the org (idempotent on slug) and link.
    #
    #   - Bare slug (legacy 1.0 / backfilled rows) → resolve by org-visible
    #     SkillDefinition, fall back to embed if files present, else skip.
    def install_skills!(agent)
      Array(@definition["skills"]).each do |entry|
        slug = entry["slug"]
        next if slug.blank?
        skill = ensure_skill!(entry)
        next unless skill
        agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
      end
    end

    def ensure_skill!(entry)
      slug = entry["slug"]
      existing = SkillDefinition.where(slug: slug)
                                 .where("organization_id = ? OR organization_id IS NULL", @organization.id)
                                 .first
      return existing if existing

      # Platform reference with no matching seed — this instance's catalog
      # is out of date relative to the template's origin. Skip with a
      # warning; surface via a follow-up notification rather than failing.
      if entry["source"] == "platform"
        Rails.logger.warn "[AgentTemplates::Installer] Platform skill #{slug} not seeded on this instance — skipping"
        return nil
      end

      # Bundle had no embedded files → can't reconstruct, skip with a log.
      if Array(entry["files"]).empty?
        Rails.logger.warn "[AgentTemplates::Installer] Skill #{slug} not in org and no embedded bundle — skipping"
        return nil
      end
      # Install the embedded bundle into the org. Slugs are GLOBALLY
      # unique — if another org owns this one, fork the name instead of
      # failing the whole install with "Slug has already been taken".
      if SkillDefinition.exists?(slug: slug)
        n = 1
        n += 1 while SkillDefinition.exists?(slug: "#{slug}-imported-#{n}") && n <= 50
        slug = "#{slug}-imported-#{n}"
      end
      record = SkillDefinition.create!(
        organization_id: @organization.id,
        slug:        slug,
        name:        entry["name"].presence || slug.humanize,
        description: entry["description"],
        category:    entry["category"].presence || "common",
        icon:        entry["icon"],
        source:      "imported",
        visibility:  "private",
        published:   true,
        requires_connections:  Array(entry["requires_connections"]),
        required_capabilities: Array(entry["required_capabilities"]),
        skill_md:    primary_md(entry),
      )
      Array(entry["files"]).each_with_index do |f, pos|
        record.skill_files.create!(
          path:      f["path"],
          content:   f["content"],
          file_type: f["file_type"].presence || File.extname(f["path"].to_s).delete_prefix(".").presence || "other",
          position:  pos,
        )
      end
      record
    end

    def primary_md(entry)
      md = Array(entry["files"]).find { |f| f["path"].to_s.casecmp?("SKILL.md") }
      md&.dig("content")
    end

    # Install per-agent approval rules from the definition. Org-wide rules
    # are intentionally not part of agent.json (they belong to the workspace
    # policy, not to the agent).
    def install_approval_rules!(agent)
      Array(@definition["approval_rules"]).each do |r|
        next unless agent.respond_to?(:approval_rules)
        agent.approval_rules.create!(
          organization_id: agent.organization_id,
          label:         r["label"],
          payload_type:  r["payload_type"],
          predicate:     r["predicate"] || {},
          auto_decision: r["auto_decision"],
          enabled:       r["enabled"] != false,
        )
      end
    rescue => e
      Rails.logger.warn "[AgentTemplates::Installer] approval_rules install failed: #{e.message}"
    end
  end
end
