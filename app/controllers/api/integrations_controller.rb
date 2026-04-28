require "net/http"
require "json"

# Single source of truth for which integrations are usable: queries Composio's
# /api/v3/auth_configs and returns the list of toolkit slugs + display labels
# that have an auth_config wired up. The engine fetches this at boot + every
# 30 min so propose_connection only ever surfaces Connect cards for things
# that will actually work.
class Api::IntegrationsController < ActionController::API
  before_action :authenticate_engine!

  # GET /api/integrations/supported?organization_id=N
  # Engine passes the agent's org_id; we read the org-scoped toolkit cache.
  def supported
    org_id = params[:organization_id].to_i
    return render(json: { items: [] }) if org_id <= 0

    render json: { items: ComposioSupported.list_for_engine(org_id) }
  rescue => e
    Rails.logger.warn "GET /api/integrations/supported failed: #{e.class}: #{e.message}"
    render json: { items: [], error: e.message }, status: :ok # don't break engine boot
  end

  private

  def authenticate_engine!
    secret = ENV["ENGINE_API_SECRET"]
    return head :unauthorized unless secret.present?
    return head :unauthorized unless request.headers["X-Engine-Secret"] == secret
  end
end
