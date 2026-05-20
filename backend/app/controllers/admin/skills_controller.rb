module Admin
  class SkillsController < BaseController
    def index
      rows = SkillDefinition.order(updated_at: :desc).map { |s| serialize(s) }
      render inertia: "admin/skills/index", props: {
        skills: rows,
        categories: Forge::SkillGenerator::CATEGORIES,
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
      skill.destroy!
      redirect_to admin_skills_path, notice: "Deleted #{skill.slug}"
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
