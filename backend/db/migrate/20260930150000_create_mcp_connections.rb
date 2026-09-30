# OAuth MCP servers get per-user tokens: the server row keeps what's shared
# (endpoints, the dynamically registered client, the resource and scope from
# discovery) and each person who signs in gets an McpConnection holding their
# own access + refresh token.
#
# auth_mode "oauth" now means exactly that. Rows that were only labelled
# "oauth" by the previous column default — a workspace token pasted or
# minted outside the MCP OAuth flow (Meta Ads), recognisable by having no
# registered client — become "token", which is also the new default.
class CreateMcpConnections < ActiveRecord::Migration[8.1]
  def up
    create_table :mcp_connections do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :mcp_server, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.text :access_token_ciphertext
      t.text :refresh_token_ciphertext
      t.datetime :expires_at
      t.jsonb :scopes, null: false, default: []
      t.string :status, null: false, default: "connected"
      t.text :last_error
      t.timestamps
    end
    add_index :mcp_connections, [ :mcp_server_id, :user_id ], unique: true

    add_column :mcp_servers, :resource, :string
    add_column :mcp_servers, :registered_redirect_uri, :string
    change_column_default :mcp_servers, :auth_mode, from: "oauth", to: "token"

    execute <<~SQL
      UPDATE mcp_servers SET auth_mode = 'token' WHERE auth_mode = 'oauth' AND client_id IS NULL
    SQL
    # Tokens an OAuth server row held before connections were per user belong
    # to whoever happened to sign in; nobody can be attributed, so they sign
    # in again rather than share one person's access.
    execute <<~SQL
      UPDATE mcp_servers SET access_token_ciphertext = NULL, refresh_token_ciphertext = NULL, expires_at = NULL
      WHERE auth_mode = 'oauth'
    SQL
  end

  def down
    change_column_default :mcp_servers, :auth_mode, from: "token", to: "oauth"
    remove_column :mcp_servers, :registered_redirect_uri
    remove_column :mcp_servers, :resource
    drop_table :mcp_connections
  end
end
