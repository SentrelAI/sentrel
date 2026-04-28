class CreateAgentToolPolicies < ActiveRecord::Migration[8.0]
  def change
    create_table :agent_tool_policies do |t|
      t.belongs_to :organization, null: false, foreign_key: true
      t.belongs_to :agent,        null: false, foreign_key: true
      # Toolkit slug as Composio knows it: 'gmail', 'hubspot', 'linkedin', etc.
      t.string :toolkit_slug, null: false
      # Preset captures the user's intent at the toolkit level. The engine
      # resolves an actual tool call by:
      #   1. denied_tools wins — explicit deny.
      #   2. preset='full' → allow all.
      #   3. allowed_tools non-empty → allow only those.
      #   4. preset rules:
      #        'read_only' → allow *_GET_*, *_LIST_*, *_FETCH_*
      #        'read_write' → above + *_CREATE_*, *_UPDATE_*, *_SEND_*, *_REPLY_*
      #        'full' → allow everything
      #        'custom' → only allowed_tools (if empty, deny all)
      t.string :preset, default: "read_write", null: false
      t.jsonb :allowed_tools, default: [], null: false
      t.jsonb :denied_tools,  default: [], null: false
      t.timestamps
    end

    add_index :agent_tool_policies, [:agent_id, :toolkit_slug],
              unique: true, name: "idx_agent_tool_policies_unique"
  end
end
