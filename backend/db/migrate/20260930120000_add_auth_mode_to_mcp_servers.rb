# How an McpServer authenticates: "oauth" (MCP auth spec, refreshable tokens),
# "token" (a static Bearer the user pasted), or "none" (a public server that
# answers without credentials). Only "none" changes behaviour — it's the one
# mode where a connected server legitimately has no access token.
class AddAuthModeToMcpServers < ActiveRecord::Migration[8.1]
  def change
    add_column :mcp_servers, :auth_mode, :string, null: false, default: "oauth"
  end
end
