# Evolve `integrations` to be backed by self-hosted Nango instead of Composio.
# `composio_connection_id` stays nullable through the migration window (dropped
# in the Composio-removal cut). New rows carry:
#   - nango_connection_id : Nango's connection id (managed/byo_oauth modes)
#   - connect_mode        : how the user connected this app
#   - provider_config_key : the Nango integration key (e.g. "google-mail")
# `byo_token` mode stores no nango_connection_id — it resolves a Credential row
# by (organization, provider) instead.
class AddNangoFieldsToIntegrations < ActiveRecord::Migration[8.0]
  def change
    add_column :integrations, :nango_connection_id, :string
    add_column :integrations, :connect_mode, :string, null: false, default: "managed"
    add_column :integrations, :provider_config_key, :string

    add_index :integrations, [:organization_id, :nango_connection_id]
  end
end
