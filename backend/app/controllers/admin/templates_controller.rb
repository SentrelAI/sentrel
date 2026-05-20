module Admin
  # Cross-tenant: AgentTemplate uses `acts_as_tenant :organization, optional: true`
  # which default-scopes queries to the current org. System templates have
  # organization_id: nil and need to be visible to platform admins. We
  # wrap every query in ActsAsTenant.without_tenant so admin sees ALL
  # templates regardless of which org owns them (or no org at all).
  class TemplatesController < BaseController
    def index
      rows = ActsAsTenant.without_tenant do
        AgentTemplate.order(updated_at: :desc).to_a.map { |t| serialize(t) }
      end
      render inertia: "admin/templates/index", props: {
        templates: rows,
        categories: AgentTemplate::CATEGORIES,
      }
    end

    def update
      ActsAsTenant.without_tenant do
        template = AgentTemplate.find(params[:id])
        attrs = params.permit(:name, :description, :category, :published, :icon,
                              :identity_md, :personality_md, :instructions_md,
                              :email_signature_md, :suggested_model, :suggested_provider)
        template.update!(attrs)
        redirect_to admin_templates_path, notice: "Updated #{template.slug}"
      end
    end

    def destroy
      ActsAsTenant.without_tenant do
        template = AgentTemplate.find(params[:id])
        template.destroy!
        redirect_to admin_templates_path, notice: "Deleted #{template.slug}"
      end
    end

    # AI Template Creator: step 1 — render the describe-your-template form.
    # No preview yet. The user fills the form, POSTs to #draft, and gets
    # the same page rendered with the preview payload populated.
    def new
      render inertia: "admin/templates/new", props: {
        categories: AgentTemplate::CATEGORIES,
        preview: nil,
        form: { description: "", name: "", role: "", category: "" },
      }
    end

    # AI Template Creator: step 2 — run TemplatePreview and re-render
    # the same page with the proposed template + skill resolution table
    # + quality score. No DB writes.
    def draft
      form = params.permit(:description, :name, :role, :category).to_h
      brief = {
        slug: form["name"].to_s.parameterize.presence,
        name: form["name"].presence,
        role: form["role"].presence,
        category: form["category"].presence,
        description: form["description"].to_s,
      }.compact

      preview = Forge::TemplatePreview.new(brief: brief).call

      render inertia: "admin/templates/new", props: {
        categories: AgentTemplate::CATEGORIES,
        form: form,
        preview: serialize_preview(preview),
      }
    end

    # AI Template Creator: step 3 — commit the (possibly edited) preview
    # to the DB. We run a full TemplatePack which re-resolves skills
    # (actually generating ones that were "would_create" in the preview)
    # and writes the row. The edited markdown fields from the preview
    # are layered on top so the user's local edits aren't lost.
    def commit
      brief = params.require(:brief).permit(:slug, :name, :role, :category, :description, :notes).to_h.symbolize_keys
      edits = params.permit(:identity_md, :personality_md, :instructions_md, :email_signature_md).to_h

      result = ActsAsTenant.without_tenant do
        Forge::TemplatePack.new(brief: brief).call
      end

      if result.ok?
        # Apply any user edits made in the preview pane (they may have
        # tweaked identity_md etc. before clicking Create).
        edits = edits.reject { |_, v| v.to_s.strip.empty? }
        result.template.update!(edits) if edits.any?
        redirect_to admin_templates_path, notice: "Created template #{result.template.slug}"
      else
        redirect_to new_admin_template_path, alert: "Template generation failed: #{result.error}"
      end
    end

    private

    def serialize_preview(preview)
      return { error: preview.error } unless preview.ok?
      {
        template_attrs: preview.template_attrs,
        requirements: preview.requirements,
        resolved_skills: preview.resolved_skills,
        unresolved_capabilities: preview.unresolved_capabilities,
        lint: preview.lint,
        duplicates: preview.duplicates,
      }
    end

    def serialize(t)
      lint = Forge::QualityLint.template(t)
      {
        id: t.id, slug: t.slug, name: t.name, role: t.role, category: t.category,
        description: t.description, icon: t.icon, published: t.published,
        install_count: t.install_count, system_template: t.system_template,
        organization_id: t.organization_id,
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
