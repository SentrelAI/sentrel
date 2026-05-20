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
        idea_bank_size: Forge::IdeaBank::ALL.size,
        defaults: { concurrency: 20, prewarm_count: 50, brief_count: 10 },
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

    private

    def env_sources
      [
        env_row("ANTHROPIC_API_KEY", ENV["ANTHROPIC_API_KEY"], true,  "Required — Forge generation"),
        env_row("SKILLS_SH_API_KEY", ENV["SKILLS_SH_API_KEY"], false, "skills.sh marketplace (8420 skills)"),
        env_row("GITHUB_TOKEN",      ENV["GITHUB_TOKEN"],      false, "GitHub Search for SKILL.md scraping"),
        env_row("COMPOSIO_API_KEY",  ENV["COMPOSIO_API_KEY"],  false, "Composio toolkit catalog refresh"),
      ]
    end

    def env_row(name, value, required, note)
      { name: name, required: required, present: value.present?,
        last_four: value.present? ? value[-4..] : nil, note: note }
    end
  end
end
