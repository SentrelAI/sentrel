# Re-applies an updated agent-bundle/v1 to an ALREADY-DEPLOYED agent —
# the redeploy half of the bundle lifecycle ("I changed the spec, push
# it to my live agent"). Spec-owned state is replaced; operator-owned
# state survives:
#
#   replaced  persona markdown (+ goal section), bundle skill content,
#             bundle-declared schedules (matched by name), knowledge docs
#   kept      name, slug, memory_md, model (unless the bundle declares
#             one), schedules/skills the user added outside the bundle,
#             already-connected channels, schedule active toggles
#
#   result = AgentBundles::Updater.new(
#     manifest: manifest, agent: agent, user: current_user, organization: current_tenant,
#   ).call
#
# Same contract as Deployer: the caller fires EngineSync. Accepts the
# same wizard overrides (persona/goal/model/schedules), minus name/slug —
# redeploy never renames, the slug anchors the agent's email address.
module AgentBundles
  class Updater < Deployer
    def initialize(agent:, **kwargs)
      @agent = agent
      super(**kwargs)
    end

    def call
      ActsAsTenant.with_tenant(@org) do
        Agent.transaction do
          update_agent!
          update_ai_config!
          update_skills!
          create_channels!(@agent) # only provisions channel types the agent doesn't have yet
          upsert_schedules!
        end
      end
      ingest_knowledge(@agent) # outside the transaction — engine call, best-effort
      collect_notices
      Result.new(agent: @agent, notices: @notices)
    end

    private

    def update_agent!
      ctx = substitution_context(@agent.name)
      attrs = {
        identity_md:     substitute(persona_value("identity"), ctx),
        personality_md:  substitute(persona_value("personality"), ctx),
        instructions_md: substitute([ persona_value("instructions"), render_goal_section ].compact.join("\n\n"), ctx)
      }
      role = @role_override || @m.role.presence
      attrs[:role] = role if role
      # Merge, don't replace: verbs the bundle doesn't mention keep
      # whatever the operator set on the platform.
      attrs[:permissions] = @agent.permissions.to_h.merge(mapped_permissions) if mapped_permissions.any?
      @agent.update!(attrs)
    end

    # Only touch model config the bundle (or wizard) actually declares — a
    # bundle without a model block must not clobber the operator's pick.
    def update_ai_config!
      cfg = @m.model.merge(@model_override.stringify_keys)
      return if cfg.blank?
      return create_ai_config!(@agent) unless @agent.ai_config

      attrs = {}
      attrs[:provider] = cfg["provider"] if cfg["provider"].present?
      model_id = cfg["model_id"].presence || cfg["id"].presence
      attrs[:model_id] = model_id if model_id
      attrs[:temperature] = cfg["temperature"] if cfg.key?("temperature")
      attrs[:max_tokens] = cfg["max_tokens"] if cfg.key?("max_tokens")
      attrs[:thinking_level] = cfg["thinking_level"] if cfg["thinking_level"].present?
      @agent.ai_config.update!(attrs) if attrs.any?
    end

    # Upsert the bundle's skills onto the agent. A skill the agent already
    # carries under the bundle's slug (exact, or the -imported-N fork the
    # original deploy created) gets its content replaced in place when this
    # org owns it; platform/global skills are never mutated — changed
    # content forks an org copy and the agent's link moves to it. Skills
    # the user attached outside the bundle are left alone.
    def update_skills!
      install_platform_skills!(@agent)
      @m.skill_bundles.each do |bundle|
        slug = sanitize_slug(bundle[:slug])
        next if slug.blank? || bundle[:files]["SKILL.md"].blank?
        linked = linked_skill_for(slug)
        skill =
          if linked.nil?
            resolve_or_create_skill(slug, bundle[:files])
          elsif linked.skill_md.to_s.strip == bundle[:files]["SKILL.md"].to_s.strip
            linked
          elsif linked.organization_id == @org.id && linked.source == "imported"
            replace_skill_content!(linked, bundle[:files])
          else
            fork = create_skill!(unique_skill_slug(slug), bundle[:files])
            @agent.agent_skills.where(skill_definition: linked).destroy_all
            fork
          end
        @agent.agent_skills.find_or_create_by!(skill_definition: skill).update!(enabled: true)
      end
    end

    # The skill this agent already carries for a bundle slug — exact match
    # first, else a -imported-N fork from the original deploy.
    def linked_skill_for(slug)
      linked = @agent.skill_definitions
      linked.find_by(slug: slug) || linked.where("slug LIKE ?", "#{slug}-imported-%").order(:slug).first
    end

    # In-place content update also reaches OTHER agents in the org sharing
    # this imported skill — same propagation SkillsController#update does
    # deliberately; their engines re-project skills on next sync/job.
    def replace_skill_content!(skill, files)
      md = files["SKILL.md"]
      meta = parse_frontmatter(md)
      skill.update!(
        name: meta["name"].presence || skill.name,
        description: meta["description"].presence || skill.description,
        category: meta["category"].presence || skill.category,
        requires_connections: Array(meta["requires_connections"]),
        skill_md: md,
      )
      skill.skill_files.destroy_all
      files.each_with_index do |(path, content), pos|
        skill.skill_files.create!(
          path: path, content: content, position: pos,
          file_type: File.extname(path).delete_prefix(".").presence || "md",
        )
      end
      skill
    end

    # Upsert by name: bundle-declared schedules update their matching cron
    # row (instruction/cron/timezone — the active toggle is the operator's,
    # kept as-is), new names are created active. Cron rows the bundle
    # doesn't mention are left untouched.
    def upsert_schedules!
      ctx = substitution_context(@agent.name)
      schedule_list.each do |sched|
        s = sched.respond_to?(:stringify_keys) ? sched.stringify_keys : sched
        next if s["name"].blank? || s["cron"].blank? || s["instruction"].blank?
        attrs = {
          instruction: substitute(s["instruction"], ctx),
          cron_expression: s["cron"],
          timezone: s["timezone"].presence || "UTC"
        }
        row = @agent.scheduled_work.find_by(mode: "cron", name: s["name"])
        if row
          row.update!(attrs)
        else
          @agent.scheduled_work.create!(organization: @org, mode: "cron", name: s["name"], active: true, **attrs)
        end
      end
    end

    # Replace, not accumulate: ingest the new text (the engine no-ops on an
    # unchanged content hash), then delete any previously-ingested doc that
    # held the same title with older content. Best-effort like deploy —
    # failures become notices, never a failed redeploy.
    def ingest_knowledge(agent)
      docs = @m.knowledge_docs
      return if docs.empty?
      existing = begin
        res = engine_request(Net::HTTP::Get, "/rag/documents?agent_id=#{agent.id}")
        Array(JSON.parse(res.body)["documents"])
      rescue => e
        Rails.logger.warn "[AgentBundles::Updater] list documents failed: #{e.message}"
        []
      end
      ctx = substitution_context(agent.name)
      docs.each do |doc|
        res = engine_request(Net::HTTP::Post, "/rag/ingest",
          body: { agent_id: agent.id, title: doc[:path], content: substitute(doc[:content], ctx) })
        new_id = JSON.parse(res.body)["documentId"]
        existing.select { |d| d["title"] == doc[:path] && d["id"] != new_id }.each do |d|
          engine_request(Net::HTTP::Delete, "/rag/documents/#{d['id']}?agent_id=#{agent.id}")
        end
      rescue => e
        Rails.logger.warn "[AgentBundles::Updater] knowledge refresh #{doc[:path]} failed: #{e.message}"
        @notices << "Knowledge doc #{doc[:path]} couldn't be refreshed — upload it on the Knowledge tab."
      end
    end
  end
end
