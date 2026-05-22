module Admin
  class SkillsController < BaseController
    include Admin::Concerns::BulkDestroyable
    bulk_destroyable SkillDefinition

    def index
      q = params[:q].to_s.strip
      category = params[:category].to_s.strip

      scope = SkillDefinition.order(updated_at: :desc)
      if q.present?
        like = "%#{q.downcase}%"
        scope = scope.where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(description) LIKE ?", like, like, like)
      end
      scope = scope.where(category: category) if category.present? && category != "all"

      pagy, rows = pagy(scope, limit: params[:per_page])

      render inertia: "admin/skills/index", props: {
        skills: rows.map { |s| serialize(s) },
        categories: Forge::SkillGenerator::CATEGORIES,
        pagy: pagy_props(pagy),
        q: q,
        category: category.presence || "all",
      }
    end

    def update
      skill = SkillDefinition.find(params[:id])
      attrs = params.permit(:name, :description, :category, :icon, :published, :skill_md)
      skill.update!(attrs)
      redirect_to admin_skills_path, notice: "Updated #{skill.slug}"
    end

    def destroy
      skill = SkillDefinition.find(params[:id])
      record_admin_destroy(skill)
      skill.destroy!
      redirect_to admin_skills_path, notice: "Deleted #{skill.slug}"
    end

    # AI Skill Creator — step 1: render the brief form. If preview_token
    # is present, also pass the current job state so the React side can
    # poll this same URL via Inertia partial reload.
    def new
      preview_state = nil
      if params[:preview_token].present?
        preview_state = SkillPreviewJob.fetch(params[:preview_token])
      end

      render inertia: "admin/skills/new", props: {
        categories: Forge::SkillGenerator::CATEGORIES,
        form: extract_form_params,
        preview_token: params[:preview_token],
        preview_state: preview_state,
      }
    end

    # AI Skill Creator — step 2: kick the preview job and redirect back
    # to #new with the token in the URL. React polls until status == done.
    def draft
      form = params.permit(:description, :name, :category, :requires_connections).to_h
      brief = {
        slug: form["name"].to_s.parameterize.presence,
        name: form["name"].presence,
        category: form["category"].presence,
        description: form["description"].to_s,
        requires_connections: form["requires_connections"].to_s.split(",").map(&:strip).reject(&:empty?),
      }.compact

      token = SecureRandom.hex(16)
      Rails.cache.write(SkillPreviewJob.cache_key(token),
                        { "status" => "queued", "queued_at" => Time.current.iso8601 },
                        expires_in: 1.hour)
      SkillPreviewJob.perform_later(token: token, brief: brief)

      # Stash form values in URL so the brief stays filled in while the
      # job runs.
      query = form.merge(preview_token: token).reject { |_, v| v.to_s.empty? }
      redirect_to new_admin_skill_path(query)
    end

    # AI Skill Creator — step 3: commit the (possibly edited) preview to
    # the DB. We rerun SkillGenerator with write_file: true to create the
    # canonical seed file + the SkillDefinition row, then layer any
    # edits the user made to the preview pane (skill_md) on top.
    def commit
      brief = params.require(:brief).permit(:slug, :name, :category, :description, :icon).to_h.symbolize_keys
      edited_skill_md = params[:skill_md].to_s

      result = Forge::SkillGenerator.new(brief: brief, write_file: true).call
      if result.ok?
        # Layer the user's edited skill_md on top of the freshly-generated
        # row, if they touched it. We update both the record and the
        # SKILL.md skill_file to keep them in sync.
        if edited_skill_md.present? && edited_skill_md != result.skill.skill_md
          result.skill.update!(skill_md: edited_skill_md)
          if (primary = result.skill.skill_files.find_by(path: "SKILL.md"))
            primary.update!(content: edited_skill_md)
          end
        end
        redirect_to admin_skills_path, notice: "Created skill #{result.skill.slug}"
      else
        redirect_to new_admin_skill_path, alert: "Skill generation failed: #{result.error}"
      end
    end

    # POST /admin/skills/:id/resync — refetches the SKILL.md (and siblings)
    # from the recorded source_url and re-ingests. No-op if source_url
    # blank (e.g. for SkillGenerator-authored rows).
    def resync
      skill = SkillDefinition.find(params[:id])
      if skill.source_url.blank?
        redirect_to admin_skills_path, alert: "#{skill.slug} has no source_url to resync from" and return
      end

      # Best-effort: parse owner/repo/path from the source_url, fetch via
      # GithubSkillsClient, hand to SkillIngestor.
      match = skill.source_url.match(%r{github\.com/([^/]+)/([^/]+)/blob/[^/]+/(.+)})
      unless match
        redirect_to admin_skills_path, alert: "#{skill.slug}: source_url shape not recognized" and return
      end

      source = "#{match[1]}/#{match[2]}"
      path   = match[3]
      manifest = Forge::GithubSkillsClient.get_skill(source: source, path: path) rescue nil
      if manifest.nil? || Array(manifest["files"]).empty?
        redirect_to admin_skills_path, alert: "Resync failed: couldn't fetch from #{skill.source_url}"
      else
        manifest["slug"] = skill.slug # preserve our slug
        res = Forge::SkillIngestor.new(manifest: manifest).call
        if res.ok?
          redirect_to admin_skills_path, notice: "Resynced #{skill.slug}"
        else
          redirect_to admin_skills_path, alert: "Resync failed: #{res.error}"
        end
      end
    end

    private

    def extract_form_params
      {
        description:          params[:description].to_s,
        name:                 params[:name].to_s,
        category:             params[:category].to_s,
        requires_connections: params[:requires_connections].to_s,
      }
    end

    def serialize(s)
      lint = Forge::QualityLint.skill(s)
      {
        id: s.id, slug: s.slug, name: s.name, category: s.category,
        description: s.description, icon: s.icon, published: s.published,
        source: s.source, source_url: s.source_url,
        requires_connections: s.requires_connections,
        skill_md: s.skill_md,
        files: s.skill_files.order(:position).map { |f| { path: f.path, file_type: f.file_type } },
        updated_at: s.updated_at, created_at: s.created_at,
        quality: { pass: lint.pass, score: lint.score, warnings: lint.warnings },
      }
    end
  end
end
