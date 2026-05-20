module Admin
  class TemplatesController < BaseController
    def index
      rows = AgentTemplate.order(updated_at: :desc).map { |t| serialize(t) }
      render inertia: "admin/templates/index", props: {
        templates: rows,
        categories: AgentTemplate::CATEGORIES,
      }
    end

    def update
      template = AgentTemplate.find(params[:id])
      attrs = params.permit(:name, :description, :category, :published, :icon,
                            :identity_md, :personality_md, :instructions_md,
                            :email_signature_md, :suggested_model, :suggested_provider)
      template.update!(attrs)
      redirect_to admin_templates_path, notice: "Updated #{template.slug}"
    end

    def destroy
      template = AgentTemplate.find(params[:id])
      template.destroy!
      redirect_to admin_templates_path, notice: "Deleted #{template.slug}"
    end

    private

    def serialize(t)
      lint = Forge::QualityLint.template(t)
      {
        id: t.id, slug: t.slug, name: t.name, role: t.role, category: t.category,
        description: t.description, icon: t.icon, published: t.published,
        install_count: t.install_count, system_template: t.system_template,
        suggested_model: t.suggested_model, suggested_provider: t.suggested_provider,
        suggested_skill_slugs: t.suggested_skill_slugs,
        suggested_integrations: t.suggested_integrations,
        identity_md: t.identity_md, personality_md: t.personality_md,
        instructions_md: t.instructions_md, email_signature_md: t.email_signature_md,
        updated_at: t.updated_at, created_at: t.created_at,
        quality: { pass: lint.pass, score: lint.score, warnings: lint.warnings },
      }
    end
  end
end
