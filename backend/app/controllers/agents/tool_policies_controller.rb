# Per-agent tool ACLs (Permissions tab on the agent edit page).
# GET  → returns current policies + the toolkits available to set policy on.
# PATCH → upsert one or more policies in a single request.
class Agents::ToolPoliciesController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # GET /agents/:agent_id/tool_policies
  def index
    policies = @agent.agent_tool_policies.includes(:agent).index_by(&:toolkit_slug)

    # Source of truth = current_tenant.integrations (the local table that
    # /integrations also renders from).
    visible = current_tenant.integrations
      .where(status: "connected")
      .where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", current_user.id)
      .pluck(:service_name)
      .uniq

    # Look up labels from the integration catalog; fall back to a
    # title-cased slug when the catalog has no entry for the slug.
    labels = IntegrationCatalog.list(@agent.organization_id)
      .index_by { |e| e[:slug] }

    render json: {
      policies: visible.map { |slug|
        p = policies[slug]
        {
          toolkit_slug: slug,
          label: labels.dig(slug, :label) || slug.titleize,
          preset: p&.preset || "read_write",
          allowed_tools: p&.allowed_tools || [],
          denied_tools: p&.denied_tools || [],
          has_policy: p.present?
        }
      }
    }
  end

  # PATCH /agents/:agent_id/tool_policies
  # body: { policies: [{ toolkit_slug, preset, allowed_tools, denied_tools }] }
  def update
    Array(params[:policies]).each do |raw|
      slug = raw[:toolkit_slug] || raw["toolkit_slug"]
      next if slug.blank?

      row = @agent.agent_tool_policies.find_or_initialize_by(toolkit_slug: slug)
      row.organization_id = @agent.organization_id
      row.preset          = (raw[:preset] || raw["preset"] || "read_write").to_s
      row.allowed_tools   = Array(raw[:allowed_tools] || raw["allowed_tools"])
      row.denied_tools    = Array(raw[:denied_tools]  || raw["denied_tools"])
      row.save!
    end

    # Tell the engine to reload — its in-memory policy cache picks the new
    # values up on the next agent run without a Machine restart.
    EngineSync.trigger(@agent) rescue nil

    render json: { ok: true }
  end

  # GET /agents/:agent_id/tool_policies/tools/:toolkit_slug — used by the
  # Permissions tab to render checkboxes per individual tool. Nango-backed
  # integrations expose a proxy surface rather than a fixed, enumerable tool
  # list, so there are no per-tool entries to choose from; policies are set
  # at the preset (read/read_write) level instead.
  def tools
    render json: { items: [] }
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  rescue ActiveRecord::RecordNotFound
    head :not_found
  end
end
