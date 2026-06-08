module AgentTemplates
  # Serialize an Agent into the portable `agent.json` shape (spec v1.0).
  # Self-contained: embeds every skill bundle (SKILL.md + supporting files),
  # capability config, approval rules, model preferences, permissions, spend
  # caps. Strips runtime state (memory, conversations, audit logs, channel
  # tokens, encrypted credential values, Fly machine ids) so the result is
  # safe to share publicly.
  #
  #   AgentTemplates::Exporter.new(agent).call
  #   # => { "spec_version" => "1.0", "kind" => "agent", ... }
  #
  # Doesn't touch the DB; pure read. Caller (Publisher) wraps in a
  # transaction when persisting the result as an AgentTemplateVersion row.
  class Exporter
    SPEC_VERSION = "1.0".freeze

    def initialize(agent, exported_by: nil)
      @agent = agent
      @exported_by = exported_by
    end

    def call
      {
        "spec_version" => SPEC_VERSION,
        "kind"         => "agent",
        "name"         => @agent.name,
        "role"         => @agent.role,
        "description"  => description,
        "category"     => category,
        "icon"         => @agent.try(:icon),
        "license"      => "CC-BY-4.0",
        "metadata"     => metadata,
        "persona"      => persona,
        "model"        => model_block,
        "capabilities" => @agent.effective_capabilities || {},
        "permissions"  => @agent.try(:permissions) || {},
        "spend_caps"   => spend_caps,
        "approval_mode"  => @agent.try(:approval_mode),
        "approval_rules" => approval_rules,
        "skills"         => skills,
        "integrations_required" => integrations_required,
        "credentials_required"  => credentials_required,
        "channels_required"     => channels_required,
        "runtime_hints"         => runtime_hints,
      }.compact
    end

    private

    def description
      "Exported from #{@agent.name}"
    end

    # Pulled from the source agent's manager.role if we can guess a sensible
    # default category; otherwise nil and the Publisher can override.
    def category
      nil
    end

    def metadata
      {
        "exported_at"            => Time.current.iso8601,
        "exported_by"            => exporter_block,
        "source_agent_public_id" => @agent.to_param,
        "source_organization_id" => @agent.organization_id,
      }.compact
    end

    def exporter_block
      return nil unless @exported_by
      { "name" => @exported_by.name, "email" => @exported_by.email }
    end

    def persona
      {
        "identity_md"        => @agent.identity_md,
        "personality_md"     => @agent.personality_md,
        "instructions_md"    => @agent.instructions_md,
        "email_signature_md" => @agent.try(:email_signature_md),
      }.compact
    end

    def model_block
      cfg = @agent.ai_config
      return {} unless cfg
      {
        "provider"       => cfg.provider,
        "model_id"       => cfg.model_id,
        "temperature"    => cfg.temperature,
        "max_tokens"     => cfg.max_tokens,
        "thinking_level" => cfg.try(:thinking_level),
      }.compact
    end

    def spend_caps
      {
        "daily_usd"            => @agent.try(:spend_daily_cap_usd),
        "monthly_usd"          => @agent.try(:spend_monthly_cap_usd),
        "notify_threshold_pct" => @agent.try(:spend_notify_threshold_pct),
      }.compact
    end

    # Only agent-scoped rules travel with a template. Org-wide rules belong
    # to the workspace, not the agent — packaging them would surface the
    # org's policy to community recipients (privacy + license footgun).
    def approval_rules
      @agent.approval_rules.where.not(agent_id: nil).map do |r|
        {
          "label"          => r.label,
          "payload_type"   => r.payload_type,
          "predicate"      => r.predicate,
          "auto_decision"  => r.auto_decision,
          "enabled"        => r.enabled,
          "scope"          => "agent",
        }.compact
      end
    end

    # Full skill bundle for every installed skill: metadata + all files.
    # This is the self-contained part — recipients don't need to fetch the
    # skill from a remote registry; the bundle ships with the template.
    def skills
      @agent.skill_definitions.includes(:skill_files).map do |s|
        {
          "slug"                  => s.slug,
          "name"                  => s.name,
          "description"           => s.description,
          "category"              => s.category,
          "icon"                  => s.icon,
          "system_prompt_fragment" => s.try(:system_prompt_fragment),
          "requires_connections"  => Array(s.requires_connections),
          "required_capabilities" => Array(s.required_capabilities),
          "required_integrations" => Array(s.try(:required_integrations)),
          "files"                 => s.skill_files.order(:position).map { |f|
            {
              "path"      => f.path,
              "content"   => f.content,
              "file_type" => f.file_type,
            }
          },
        }.compact
      end
    end

    # Distinct integrations any embedded skill depends on — recipient
    # connects these post-install. Names match Composio toolkit slugs.
    def integrations_required
      slugs = @agent.skill_definitions
                    .flat_map { |s| Array(s.requires_connections) }
                    .map(&:to_s).map(&:downcase).uniq
      slugs.map { |slug| { "service" => slug, "why" => "required by a bundled skill" } }
    end

    # Hints only — no secret values. Recipient adds their own keys at
    # /settings/credentials. Pulls from each granted credential's
    # (kind, provider) — bare names so we don't leak how the source org
    # labels their keys.
    def credentials_required
      @agent.credentials.map do |c|
        { "kind" => c.kind, "provider" => c.provider, "name_hint" => c.name }
      end.uniq
    end

    # Channel TYPES the source agent has connected — recipient reconnects
    # their own (no tokens, no addresses transferred).
    def channels_required
      @agent.channel_configs.where(enabled: true).pluck(:channel_type).uniq.map do |type|
        { "type" => type, "why" => "primary channel on source agent" }
      end
    end

    # Optional per-runtime overrides. Today only "claude_agent_sdk"; future
    # runtimes ignore unfamiliar keys. Open contract — additive.
    def runtime_hints
      {
        "claude_agent_sdk" => {
          "tool_routing" => ENV["TOOL_ROUTING"].presence || "smart",
        }.compact,
      }
    end
  end
end
