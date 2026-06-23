# Per-(org, provider) connection policy + bring-your-own OAuth-app credentials.
#
# `mode` is the org's default connect mode for this provider:
#   managed   — OAuth through Sentrel's shared Nango integration (the default).
#   byo_oauth — OAuth on the org's OWN app; client_id/secret ride on the Nango
#               connection via oauth_client_id_override / oauth_client_secret_override.
#   byo_token — the user pastes a token; stored as a Credential, not in Nango.
#
# A missing row = managed. The client secret is encrypted at rest like the
# OAuth tokens on McpServer / OauthCredential.
class CreateOrgIntegrationConfigs < ActiveRecord::Migration[8.0]
  def change
    create_table :org_integration_configs do |t|
      t.references :organization, null: false, foreign_key: true, index: true
      t.string  :provider, null: false                       # "google-mail", "facebook", ...
      t.string  :mode,     null: false, default: "managed"   # managed | byo_oauth | byo_token

      # BYO-OAuth app credentials (only used when mode == "byo_oauth").
      t.string  :client_id
      t.text    :client_secret_ciphertext
      t.jsonb   :scopes, null: false, default: []

      t.timestamps
    end

    add_index :org_integration_configs, [:organization_id, :provider], unique: true
  end
end
