module Admin
  # Landing for /admin. Surfaces enough headline numbers + recent activity
  # so the team can spot regressions without opening rails console.
  class DashboardController < BaseController
    def index
      # AgentTemplate + Agent use acts_as_tenant — admin needs to break out
      # of that to see cross-org rows (system templates have org_id: nil).
      counts, recent_templates, recent_skills = ActsAsTenant.without_tenant do
        c = {
          templates: AgentTemplate.count,
          templates_published: AgentTemplate.where(published: true).count,
          skills: SkillDefinition.count,
          skills_published: SkillDefinition.where(published: true).count,
          agents: Agent.count,
          users: User.count,
          organizations: Organization.count,
        }
        rt = AgentTemplate.order(updated_at: :desc).limit(8).map { |t| template_row(t) }
        rs = SkillDefinition.order(updated_at: :desc).limit(8).map { |s| skill_row(s) }
        [c, rt, rs]
      end

      render inertia: "admin/dashboard", props: {
        counts: counts,
        env_sources: env_sources,
        recent_templates: recent_templates,
        recent_skills: recent_skills,
        last_run: Forge::Bootstrap.load_state,
      }
    end

    private

    def env_sources
      [
        env_row("ANTHROPIC_API_KEY", ENV["ANTHROPIC_API_KEY"], true,  "Required — Forge generation"),
        env_row("SKILLS_SH_API_KEY", ENV["SKILLS_SH_API_KEY"], false, "skills.sh marketplace (8420 skills)"),
        env_row("GH_TOKEN",      ENV["GH_TOKEN"],      false, "GitHub Search source for SKILL.md scraping"),
        env_row("COMPOSIO_API_KEY",  ENV["COMPOSIO_API_KEY"],  false, "Live Composio toolkit catalog refresh"),
      ]
    end

    def env_row(name, value, required, note)
      {
        name: name, required: required, present: value.present?,
        last_four: value.present? ? value[-4..] : nil, note: note,
      }
    end

    def template_row(t)
      lint = Forge::QualityLint.template(t)
      {
        id: t.id, slug: t.slug, name: t.name, role: t.role, category: t.category,
        published: t.published, install_count: t.install_count,
        suggested_model: t.suggested_model, updated_at: t.updated_at,
        quality_pass: lint.pass, quality_score: lint.score,
      }
    end

    def skill_row(s)
      lint = Forge::QualityLint.skill(s)
      {
        id: s.id, slug: s.slug, name: s.name, category: s.category,
        published: s.published, source: s.source, source_url: s.source_url,
        requires_connections: s.requires_connections, updated_at: s.updated_at,
        quality_pass: lint.pass, quality_score: lint.score,
      }
    end
  end
end
