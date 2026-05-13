class Api::SkillsController < ApplicationController
  skip_before_action :verify_authenticity_token

  before_action :verify_engine_secret!

  # POST /api/skills
  # Engine-side endpoint called by the skills.create MCP tool. The agent
  # composes a new skill (name + slug + files), we persist it as an
  # org-scoped draft owned by the calling agent's organization. Idempotent
  # on (org_id, slug) — calling twice with the same slug just updates the
  # files.
  #
  # Request:
  #   {
  #     agent_id: 12,
  #     name: "ScribeMD Articles publishing",
  #     slug: "scribemd-articles",            # optional, generated from name
  #     description: "...",
  #     category: "content",                  # optional, default "generic"
  #     icon: "rss",                          # optional
  #     files: [
  #       { path: "SKILL.md", content: "..." },
  #       { path: "examples/draft.json", content: "..." },
  #     ]
  #   }
  #
  # Response:
  #   201 { ok: true, slug, version, files_count }
  #   422 { error: "..." }
  def create
    agent = Agent.find(params.require(:agent_id))
    name        = params.require(:name).to_s.strip
    description = params[:description].to_s
    category    = params[:category].to_s.presence || "generic"
    icon        = params[:icon].to_s.presence
    files       = normalize_files(params[:files])

    return render(json: { error: "no files" }, status: :unprocessable_entity) if files.empty?
    return render(json: { error: "SKILL.md required" }, status: :unprocessable_entity) unless files.any? { |f| f["path"] == "SKILL.md" && f["content"].to_s.strip.present? }

    desired_slug = SkillDefinition.unique_slug(params[:slug].to_s.presence || name)

    ActsAsTenant.with_tenant(agent.organization) do
      cred = SkillDefinition.find_by(organization_id: agent.organization_id, slug: desired_slug)
      cred ||= SkillDefinition.new(
        organization_id: agent.organization_id,
        slug: desired_slug,
        source: "user_made",
        visibility: "private",
        published: false,
        version: 1,
        install_count: 0,
        created_by_user_id: nil,
      )
      cred.assign_attributes(
        name: name,
        description: description.presence,
        category: category,
        icon: icon,
      )
      cred.skill_md = files.find { |f| f["path"] == "SKILL.md" }["content"]
      cred.save!

      sync_files!(cred, files)
      cred.sync_legacy_skill_md!
      EngineSync.trigger_for_skill(cred)

      render json: { ok: true, slug: cred.slug, id: cred.id, version: cred.version, files_count: cred.skill_files.count }
    end
  rescue ActiveRecord::RecordNotFound
    render json: { error: "agent not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /api/skills/install_on_agent
  # Self-installs a skill on the calling agent so the agent can immediately
  # start using the SKILL.md it just authored.
  #
  # Request: { agent_id, slug }
  # Response: 200 { ok: true, installed: true } | 404 | 403
  def install_on_agent
    agent = Agent.find(params.require(:agent_id))
    slug  = params.require(:slug).to_s

    skill = SkillDefinition.visible_to(agent.organization).find_by(slug: slug)
    return render(json: { error: "skill not found / not visible" }, status: :not_found) unless skill

    grant = agent.agent_skills.find_or_create_by!(skill_definition_id: skill.id) do |row|
      row.enabled = true
    end
    grant.update!(enabled: true) unless grant.enabled

    EngineSync.trigger(agent)
    render json: { ok: true, installed: true, slug: skill.slug }
  rescue ActiveRecord::RecordNotFound
    render json: { error: "agent not found" }, status: :not_found
  end

  private

  def normalize_files(raw)
    return [] if raw.blank?
    arr = raw.is_a?(Array) ? raw : Array(raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h.values : raw.to_h.values)
    arr.filter_map do |f|
      h = f.respond_to?(:to_unsafe_h) ? f.to_unsafe_h : f.to_h
      path = h["path"].to_s.strip.sub(%r{\A/+}, "")
      next if path.blank?
      { "path" => path, "content" => h["content"].to_s, "position" => h["position"] || 0 }
    end
  end

  def sync_files!(skill, files)
    incoming_paths = files.map { |f| f["path"] }
    skill.skill_files.where.not(path: incoming_paths).destroy_all
    files.each_with_index do |f, idx|
      row = skill.skill_files.find_or_initialize_by(path: f["path"])
      row.assign_attributes(content: f["content"], position: f["position"] || idx)
      row.save!
    end
  end

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
