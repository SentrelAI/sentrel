# Deploys a validated agent-bundle/v1 Manifest as a LIVE Agent in the
# org — the server half of "npx agent-spec deploy" / "install from
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

    def initialize(manifest:, user:, organization:)
      @m = manifest
      @user = user
      @org = organization
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
        end
      end
      ingest_knowledge(agent) # outside the transaction — engine call, best-effort
      collect_notices
      Result.new(agent: agent, notices: @notices)
    end

    private

    def build_agent
      slug = unique_agent_slug(@m.name)
      goal_section = render_goal_section
      @org.agents.build(
        name: @m.name,
        slug: slug,
        role: @m.role.presence || "Agent",
        identity_md:     @m.persona_md("identity"),
        personality_md:  @m.persona_md("personality"),
        instructions_md: [@m.persona_md("instructions"), goal_section].compact.join("\n\n"),
        permissions: mapped_permissions,
      )
    end

    # goal: {mission:, kpis: [{k => v}], definition_of_done:} → a markdown
    # section appended to instructions_md so the engine's system prompt
    # carries it without needing a new column or prompt-builder change.
    def render_goal_section
      g = @m.goal
      return nil unless g
      lines = ["## Goal", "", g["mission"].to_s.strip]
      kpis = Array(g["kpis"]).filter_map { |kpi| kpi.is_a?(Hash) ? kpi.first : nil }
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
      @m.permissions.each_with_object({}) do |(verb, level), h|
        h[verb.to_s] = PERMISSION_MAP[level.to_s] || level.to_s
      end
    end

    def create_ai_config!(agent)
      cfg = @m.model
      agent.create_ai_config!(
        provider:       cfg["provider"].presence || "anthropic",
        model_id:       (cfg["id"] || cfg["model_id"]).presence || "claude-sonnet-4-6",
        temperature:    cfg["temperature"] || 0.7,
        max_tokens:     cfg["max_tokens"] || 8192,
        thinking_level: cfg["thinking_level"].presence || "none",
      )
    end

    # Same collision policy as AgentTemplates::Importer: reuse an
    # equivalent org skill, fork a conflicting one to <slug>-imported-<n>,
    # create verbatim otherwise.
    def install_skills!(agent)
      @m.skill_bundles.each do |bundle|
        slug = sanitize_slug(bundle[:slug])
        next if slug.blank? || bundle[:files]["SKILL.md"].blank?

        existing = SkillDefinition.where(slug: slug)
                                  .where("organization_id = ? OR organization_id IS NULL", @org.id)
                                  .first
        skill =
          if existing.nil?
            create_skill!(slug, bundle[:files])
          elsif existing.skill_md.to_s.strip == bundle[:files]["SKILL.md"].to_s.strip
            existing
          else
            create_skill!(unique_skill_slug(slug), bundle[:files])
          end
        agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
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
      base = ENV.fetch("ENGINE_URL", "http://localhost:3300")
      secret = ENV["ENGINE_API_SECRET"].to_s
      docs.each do |doc|
        uri = URI.parse("#{base}/rag/ingest")
        req = Net::HTTP::Post.new(uri, { "Content-Type" => "application/json", "X-Engine-Secret" => secret })
        req.body = { agent_id: agent.id, filename: doc[:path], text: doc[:content] }.to_json
        res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https", open_timeout: 2, read_timeout: 15) { |h| h.request(req) }
        raise "HTTP #{res.code}" unless res.is_a?(Net::HTTPSuccess)
      rescue => e
        Rails.logger.warn "[AgentBundles::Deployer] knowledge ingest #{doc[:path]} failed: #{e.message}"
        @notices << "Knowledge doc #{doc[:path]} couldn't be ingested yet — upload it on the Knowledge tab once the agent is running."
      end
    end

    def collect_notices
      services = @m.integrations.filter_map { |i| i["service"] }
      @notices << "Connect at /integrations: #{services.join(', ')}" if services.any?
      mcp = @m.integrations.select { |i| i["type"] == "mcp" }.filter_map { |i| i["name"] }
      @notices << "MCP integrations aren't supported yet (skipped): #{mcp.join(', ')}" if mcp.any?
      @notices << "Add secrets at /settings/credentials: #{@m.secret_names.join(', ')}" if @m.secret_names.any?
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

    def parse_frontmatter(md)
      m = md.to_s.match(/\A---\n(.*?)\n---/m)
      return {} unless m
      YAML.safe_load(m[1]) || {}
    rescue Psych::SyntaxError
      {}
    end
  end
end
