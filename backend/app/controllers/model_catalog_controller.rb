# Serves the web model pickers. `groups` is the curated shortlist the dropdown
# opens on; `all` is every model synced from models.dev, which the search box
# filters over — that's what makes "point this agent at any model" true without
# a deploy per release.
class ModelCatalogController < ApplicationController
  before_action :authenticate_user!

  def show
    connected = anthropic_account_connected?
    render json: {
      groups: ModelCatalog.groups(anthropic_account_connected: connected),
      all: ModelCatalog.all(anthropic_account_connected: connected),
      default_model: ModelCatalog.default_model,
      synced_at: CatalogModel.maximum(:synced_at)
    }
  end

  private

  def anthropic_account_connected?
    OauthCredential.exists?(
      organization_id: current_tenant.id,
      provider: "anthropic",
      kind: "ai_provider"
    )
  rescue StandardError
    false
  end
end
