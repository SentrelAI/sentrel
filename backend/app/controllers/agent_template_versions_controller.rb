class AgentTemplateVersionsController < ApplicationController
  before_action :authenticate_user!

  # GET /agent_templates/:agent_template_id/versions
  # Lightweight metadata for the version dropdown — no definition payloads.
  def index
    template = find_template!
    render json: template.versions.map { |v| metadata(v) }
  end

  # GET /agent_templates/:agent_template_id/versions/:id
  # Full definition for one specific version. The show page uses this when
  # the user picks a non-current version from the dropdown so we don't
  # have to fetch the whole template page over again.
  def show
    template = find_template!
    version  = template.versions.find_by!(version_number: params[:id].to_i)
    render json: metadata(version).merge(definition: version.definition)
  end

  private

  def find_template!
    tenant = current_tenant
    ActsAsTenant.without_tenant do
      AgentTemplate.visible_to(tenant).find_by!(slug: params[:agent_template_id])
    end
  end

  def metadata(v)
    {
      version_number: v.version_number,
      spec_version:   v.spec_version,
      license:        v.license,
      changelog:      v.changelog,
      created_at:     v.created_at,
      created_by:     v.created_by_user&.name,
      published:      v.published,
    }
  end
end
