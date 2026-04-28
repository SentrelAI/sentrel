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
    # /integrations also renders from). Same data, no Composio HTTP, no
    # dependency on the new toolkit cache being warm.
    visible = current_tenant.integrations
      .where(status: "connected")
      .where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", current_user.id)
      .pluck(:service_name)
      .uniq

    # Look up labels from the toolkit cache when available; fall back to a
    # title-cased slug when the cache is cold OR the table doesn't exist
    # (db:migrate hasn't run yet on this environment).
    labels = begin
      if ActiveRecord::Base.connection.table_exists?("composio_toolkit_caches")
        ComposioToolkitCache.where(organization_id: @agent.organization_id, slug: visible).pluck(:slug, :label).to_h
      else
        {}
      end
    rescue StandardError => e
      Rails.logger.warn "ToolPolicies labels lookup skipped: #{e.class}: #{e.message}"
      {}
    end

    render json: {
      policies: visible.map { |slug|
        p = policies[slug]
        {
          toolkit_slug: slug,
          label: labels[slug] || ComposioSupported.prettify_label(slug.titleize),
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
