module Admin
  # Lets an admin kick off + monitor a Forge bootstrap run from the UI
  # without dropping to the rails console.
  class ForgeController < BaseController
    PROGRESS_CACHE_KEY = "forge:last_run".freeze

    def show
      render inertia: "admin/forge", props: {
        env_sources: env_sources,
        state: Forge::Bootstrap.load_state,
        last_run: Rails.cache.read(PROGRESS_CACHE_KEY),
        last_dedup: Rails.cache.read("forge:last_dedup"),
        idea_bank_size: Forge::IdeaBank::ALL.size,
        defaults: { concurrency: 20, prewarm_count: 50, brief_count: 10 }
      }
    end

    # POST /admin/forge → kick the bootstrap job async. Body params:
    #   concurrency, prewarm_count, brief_count (cap from IdeaBank), resume (bool)
    def create
      concurrency   = params[:concurrency].to_i.clamp(1, 30)
      prewarm_count = params[:prewarm_count].to_i.clamp(0, 100)
      brief_count   = params[:brief_count].to_i
      resume        = ActiveModel::Type::Boolean.new.cast(params[:resume])

      briefs = brief_count.positive? ? Forge::IdeaBank::ALL.first(brief_count) : Forge::IdeaBank::ALL

      ForgeBootstrapJob.perform_later(
        brief_slugs: briefs.map { |b| b[:slug] },
        concurrency: concurrency,
        prewarm_count: prewarm_count,
        resume: resume,
      )

      redirect_to admin_forge_path, notice: "Bootstrap queued (#{briefs.size} briefs, concurrency #{concurrency})"
    end

    # Clear the resumable state — admin can reset a stuck run.
    def reset_state
      Forge::Bootstrap.reset_state!
      Rails.cache.delete(PROGRESS_CACHE_KEY)
      redirect_to admin_forge_path, notice: "Forge state cleared"
    end

    # Quick action: run QualityLint over every template + skill, print
    # pass/fail summary as flash notice. Optionally auto-unpublish
    # failures when params[:unpublish] is truthy.
    def lint
      unpublish = ActiveModel::Type::Boolean.new.cast(params[:unpublish])
      template_pass = template_fail = skill_pass = skill_fail = 0
      unpublished_count = 0

      ActsAsTenant.without_tenant do
        AgentTemplate.where(system_template: true).find_each do |t|
          r = Forge::QualityLint.template(t)
          if r.pass then template_pass += 1
          else
            template_fail += 1
            if unpublish && t.published?
              t.update!(published: false)
              unpublished_count += 1
            end
          end
        end
        SkillDefinition.find_each do |s|
          r = Forge::QualityLint.skill(s)
          if r.pass then skill_pass += 1
          else
            skill_fail += 1
            if unpublish && s.published?
              s.update!(published: false)
              unpublished_count += 1
            end
          end
        end
      end

      msg = "Lint: templates #{template_pass}✓/#{template_fail}✗ · skills #{skill_pass}✓/#{skill_fail}✗"
      msg += " · unpublished #{unpublished_count}" if unpublish
      redirect_to admin_forge_path, notice: msg
    end

    # Quick action: republish anything that now passes lint under current
    # rules. Useful after loosening QualityLint thresholds.
    def republish_passing
      republished = 0
      ActsAsTenant.without_tenant do
        AgentTemplate.where(system_template: true, published: false).find_each do |t|
          r = Forge::QualityLint.template(t)
          if r.pass
            t.update!(published: true)
            republished += 1
          end
        end
      end
      redirect_to admin_forge_path, notice: "Republished #{republished} templates that now pass lint"
    end

    # Quick action: scan for near-duplicates across all published templates.
    # Cheap (no LLM); result rendered inline as a flash.
    def dedup
      groups = ActsAsTenant.without_tenant do
        Forge::DedupDetector.find_groups(AgentTemplate.where(published: true))
      end
      if groups.empty?
        redirect_to admin_forge_path, notice: "No near-duplicate groups found (threshold #{Forge::DedupDetector::THRESHOLD})"
      else
        # Stash the groups in cache so the page can read + render them.
        Rails.cache.write("forge:last_dedup", groups.map { |g| g.map(&:slug) }, expires_in: 1.day)
        redirect_to admin_forge_path, notice: "#{groups.size} near-duplicate group(s) found — see Dedup panel"
      end
    end

    private

    def env_sources
      [
        env_row("ANTHROPIC_API_KEY", ENV["ANTHROPIC_API_KEY"], true,  "Required — Forge generation"),
        env_row("SKILLS_SH_API_KEY", ENV["SKILLS_SH_API_KEY"], false, "skills.sh marketplace (8420 skills)"),
        env_row("GH_TOKEN",      ENV["GH_TOKEN"],      false, "GitHub Search for SKILL.md scraping"),
        env_row("COMPOSIO_API_KEY",  ENV["COMPOSIO_API_KEY"],  false, "Composio toolkit catalog refresh")
      ]
    end

    def env_row(name, value, required, note)
      { name: name, required: required, present: value.present?,
        last_four: value.present? ? value[-4..] : nil, note: note }
    end
  end
end
