module Admin
  # Cross-tenant: AgentTemplate uses `acts_as_tenant :organization, optional: true`
  # which default-scopes queries to the current org. System templates have
  # organization_id: nil and need to be visible to platform admins. We
  # wrap every query in ActsAsTenant.without_tenant so admin sees ALL
  # templates regardless of which org owns them (or no org at all).
  class TemplatesController < BaseController
    include Admin::Concerns::BulkDestroyable
    bulk_destroyable AgentTemplate, tenant_bypass: true

    def index
      q = params[:q].to_s.strip
      category = params[:category].to_s.strip

      pagy, rows = ActsAsTenant.without_tenant do
        scope = AgentTemplate.order(updated_at: :desc)
        if q.present?
          like = "%#{q.downcase}%"
          scope = scope.where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(role) LIKE ?", like, like, like)
        end
        scope = scope.where(category: category) if category.present? && category != "all"
        pagy(scope, limit: params[:per_page])
      end

      render inertia: "admin/templates/index", props: {
        templates: rows.map { |t| serialize(t) },
        categories: AgentTemplate::CATEGORIES,
        pagy: pagy_props(pagy),
        q: q,
        category: category.presence || "all"
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
        record_admin_destroy(template)
        template.destroy!
        redirect_to admin_templates_path, notice: "Deleted #{template.slug}"
      end
    end

    # AI Template Creator: step 1 — render the describe-your-template form.
    # If preview_token is present, also include the current job status
    # (so the React side can poll this same URL via Inertia partial reload).
    def new
      preview_state = nil
      if params[:preview_token].present?
        preview_state = TemplatePreviewJob.fetch(params[:preview_token])
      end

      render inertia: "admin/templates/new", props: {
        categories: AgentTemplate::CATEGORIES,
        form: extract_form_params,
        preview_token: params[:preview_token],
        preview_state: preview_state # nil | { status:, preview?:, error? }
      }
    end

    # AI Template Creator: step 2 — kick the preview job and redirect
    # back to #new with the token in the URL. The React side polls
    # via Inertia partial reload until preview_state.status == "done".
    def draft
      form = params.permit(:description, :name, :role, :category).to_h
      brief = {
        slug: form["name"].to_s.parameterize.presence,
        name: form["name"].presence,
        role: form["role"].presence,
        category: form["category"].presence,
        description: form["description"].to_s
      }.compact

      token = SecureRandom.hex(16)
      Rails.cache.write(TemplatePreviewJob.cache_key(token),
                        { "status" => "queued", "queued_at" => Time.current.iso8601 },
                        expires_in: 1.hour)
      TemplatePreviewJob.perform_later(token: token, brief: brief)

      # Stash the form values in the URL so the page renders with the
      # same brief filled in while the job runs.
      query = form.merge(preview_token: token).reject { |_, v| v.to_s.empty? }
      redirect_to new_admin_template_path(query)
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

    # Mirrors the filter logic in #index so a "Select all matching" bulk
    # destroy targets exactly the same rows the user is seeing across
    # pages.
    def bulk_destroy_filter_scope(model)
      scope = model.all
      q = params[:q].to_s.strip
      category = params[:category].to_s.strip
      if q.present?
        like = "%#{q.downcase}%"
        scope = scope.where("LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(role) LIKE ?", like, like, like)
      end
      scope = scope.where(category: category) if category.present? && category != "all"
      scope
    end

    def extract_form_params
      {
        description: params[:description].to_s,
        name:        params[:name].to_s,
        role:        params[:role].to_s,
        category:    params[:category].to_s
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
        quality: { pass: lint.pass, score: lint.score, warnings: lint.warnings }
      }
    end
  end
end
