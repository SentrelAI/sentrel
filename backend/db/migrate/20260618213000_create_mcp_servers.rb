# External MCP servers an org connects (OAuth-protected remote MCP endpoints
# the Composio toolkits don't cover — e.g. Meta's official Ads MCP). Holds the
# connection config + the OAuth tokens (encrypted), so an agent's engine can
# attach the server with a fresh Bearer token. Provider-agnostic: any MCP-spec
# OAuth server (RFC 9728 protected resource) plugs in via discovery.
class CreateMcpServers < ActiveRecord::Migration[8.0]
  def change
    create_table :mcp_servers do |t|
      t.references :organization, null: false, foreign_key: true, index: true
      # null agent_id = available org-wide to every agent; set = scoped to one.
      t.references :agent, null: true, foreign_key: true, index: true

      t.string  :name,       null: false              # display name ("Meta Ads")
      t.string  :slug,       null: false              # "meta_ads"
      t.string  :url,        null: false              # MCP resource URL (https://mcp.facebook.com/ads)
      t.string  :transport,  null: false, default: "http"  # http | sse | stdio
      t.jsonb   :scopes,     null: false, default: []

      # OAuth client + discovered authorization-server metadata (cached).
      t.string  :client_id
      t.string  :issuer
      t.string  :authorize_endpoint
      t.string  :token_endpoint

      # Tokens at rest (encrypted via Active Record Encryption, like OauthCredential).
      t.text    :access_token_ciphertext
      t.text    :refresh_token_ciphertext
      t.datetime :expires_at

      t.string  :status,  null: false, default: "disconnected"  # disconnected | connected | error
      t.boolean :enabled, null: false, default: true
      t.text    :last_error

      t.timestamps
    end

    add_index :mcp_servers, [ :organization_id, :slug ], unique: true
  end
end
