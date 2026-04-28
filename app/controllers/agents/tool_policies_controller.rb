# Per-agent tool ACLs (Permissions tab on the agent edit page).
# GET  → returns current policies + the toolkits available to set policy on.
# PATCH → upsert one or more policies in a single request.
class Agents::ToolPoliciesController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # GET /agents/:agent_id/tool_policies
  def index
    policies = @agent.agent_tool_policies.includes(:agent).index_by(&:toolkit_slug)

    # Catalog of toolkits the agent could have a policy on — only services
    # connected at workspace OR personal level are surfaced. We fetch tool
    # lists lazily on the frontend (separate /tools/:slug call) so this
    # response stays cheap.
    visible_integrations = @agent.organization.integrations
      .where(status: "connected")
      .where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", current_user.id)
      .pluck(:service_name)
      .uniq

    render json: {
      policies: visible_integrations.map { |slug|
        p = policies[slug]
        {
          toolkit_slug: slug,
          preset: p&.preset || "read_write",
          allowed_tools: p&.allowed_tools || [],
          denied_tools: p&.denied_tools || [],
          has_policy: p.present?,
        }
      },
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
  # Permissions tab to render checkboxes per individual tool. Pulls from
  # ComposioSupported.tools_for which is cached for 1h.
  def tools
    slug = params[:toolkit_slug].to_s
    render json: { items: ComposioSupported.tools_for(slug) }
  end

  private

  def set_agent
    @agent = current_tenant.agents.find_by!("agents.id = ? OR agents.public_id = ?", params[:agent_id].to_i, params[:agent_id])
  rescue ActiveRecord::RecordNotFound
    head :not_found
  end
end
