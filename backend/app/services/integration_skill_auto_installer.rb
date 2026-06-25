# Auto-installs the skills that depend on a newly-connected integration
# onto every agent in the org that can plausibly use them.
#
# Example: user connects Apollo →
#   - finds SkillDefinition.where("requires_connections @> ['apollo']")
#     → [apollo-prospecting]
#   - for each Agent in the org with capabilities.integrations.enabled
#     → creates AgentSkill row (if missing), enabled=true
#   - fires EngineSync per agent so each engine syncs the new skill
#     content from DB without waiting for the next message
#
# Idempotent: AgentSkill has a unique constraint on (agent_id,
# skill_definition_id), so re-running won't double-install. Already-
# installed agents are skipped, not toggled.
#
# Conservative scope: only installs on agents that have the
# `integrations` capability enabled. A no-integrations agent (an
# internal-only HR bot, for example) doesn't benefit from skills that
# need an external connection, and adding the SKILL.md content would
# just bloat its system prompt.
class IntegrationSkillAutoInstaller
  Result = Struct.new(:installed, :skipped, :skills_matched, keyword_init: true)

  def initialize(integration)
    @integration = integration
  end

  def call
    service = @integration.service_name.to_s.downcase
    return empty_result if service.blank?

    # PostgreSQL jsonb containment — finds skills whose
    # requires_connections array contains the toolkit slug. Restricted
    # to canonical platform seeds + skills the org itself owns: without
    # this guard, a polluted catalog (Forge-generated junk tagged with
    # popular services like googlecalendar) gets mass-installed onto
    # every agent the moment the org connects that service.
    matching_skills = SkillDefinition
      .where(published: true)
      .where("requires_connections @> ?::jsonb", [ service ].to_json)
      .where("slug IN (?) OR organization_id = ?", SkillDefinition.canonical_seed_slugs, @integration.organization_id)
      .to_a

    return empty_result(matching_skills) if matching_skills.empty?

    org_id = @integration.organization_id
    installed = 0
    skipped = 0
    touched_agents = Set.new

    Agent.where(organization_id: org_id).find_each do |agent|
      next unless agent_uses_integrations?(agent)

      matching_skills.each do |skill|
        row = agent.agent_skills.find_or_initialize_by(skill_definition: skill)
        if row.new_record?
          row.enabled = true
          row.save!
          installed += 1
          touched_agents << agent.id
        else
          skipped += 1
        end
      end
    end

    # Fire EngineSync per touched agent so its /data/skills/ refreshes
    # with the new SKILL.md content immediately. Without this the
    # skill is "installed" in the DB but the agent doesn't see it
    # until its next per-job sync.
    touched_agents.each do |agent_id|
      agent = Agent.find_by(id: agent_id)
      EngineSync.trigger(agent) if agent
    end

    Result.new(installed: installed, skipped: skipped, skills_matched: matching_skills.map(&:slug))
  end

  private

  def empty_result(matching_skills = [])
    Result.new(installed: 0, skipped: 0, skills_matched: matching_skills.map(&:slug))
  end

  # Conservative gate — only auto-install on agents that actually have
  # integrations turned on. Reading from the agent's capabilities
  # jsonb the same way the engine does.
  def agent_uses_integrations?(agent)
    caps = agent.capabilities || {}
    integrations = caps["integrations"] || caps[:integrations] || {}
    integrations.is_a?(Hash) ? integrations["enabled"] != false && integrations[:enabled] != false : true
  end
end
