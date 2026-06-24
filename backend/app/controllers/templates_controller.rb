# Public, unauthenticated gallery of community + system agent templates.
# Anyone — logged out included — can browse what's on offer; each card's
# "Deploy" button funnels into the standard new-agent workflow
# (/agents/new?template=…), which itself prompts sign-in when needed.
#
# Distinct from the in-app /agent_templates page (AgentTemplatesController),
# which is auth-gated and also exposes publish/import/version management.
class TemplatesController < ApplicationController
  # Intentionally NO `authenticate_user!` — this page is public.

  # GET /templates
  #
  # acts_as_tenant stacks AgentTemplate's default org scope on top of
  # `visible_to`, which would hide the system seeds (organization_id IS NULL).
  # Wrap in without_tenant so `visible_to` does the access check itself:
  #   - logged out (tenant nil) → published system seeds only
  #   - logged in               → system seeds + this org's published templates
  def index
    tenant = current_tenant
    templates = ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant)
                   .includes(:created_by_user)
                   .order(:category, :name)
                   .map(&:card_attributes)
    end

    render inertia: "templates/public", props: {
      templates: templates,
      categories: AgentTemplate::CATEGORIES
    }
  end

  # GET /templates/:slug
  #
  # Public detail page for a single template — what the agent is, how it works,
  # which skills/model it uses — with a Deploy button. Persona copy is run
  # through AgentTemplate#render so {{company_name}} / {{user_name}} tokens read
  # cleanly instead of leaking raw mustache to anonymous visitors.
  def show
    tenant = current_tenant
    template = ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant).find_by!(slug: params[:slug])
    end
    persona = template.render

    render inertia: "templates/public_show", props: {
      template: template.card_attributes.merge(
        identity_md: persona[:identity_md],
        personality_md: persona[:personality_md],
        instructions_md: persona[:instructions_md],
        integrations: integrations_for(template),
        capabilities: capability_keys(template),
        skills: skills_for(template),
        suggested_model: template.suggested_model,
        suggested_provider: template.suggested_provider,
      )
    }
  end

  private

  # External apps the agent connects to, resolved to catalog labels (and logos
  # when present). These are the headline "Tools it connects to".
  def integrations_for(template)
    Array(template.suggested_integrations).map do |slug|
      entry = IntegrationCatalog.find(slug)
      { slug: slug, label: entry&.dig(:label) || slug.humanize, logo: entry&.dig(:logo).presence }
    end
  end

  # Built-in tool groups toggled on (knowledge base, tasks, scheduling…).
  def capability_keys(template)
    (template.capabilities || {}).select { |_, v| v.is_a?(Hash) ? v["enabled"] : v }.keys
  end

  # Installed skill packages, resolved to their friendly name (falls back to the
  # slug if no SkillDefinition row exists).
  def skills_for(template)
    slugs = Array(template.suggested_skill_slugs)
    names = ActsAsTenant.without_tenant { SkillDefinition.where(slug: slugs).pluck(:slug, :name).to_h }
    slugs.map { |slug| { slug: slug, name: names[slug].presence || slug.tr("-_", " ") } }
  end
end
