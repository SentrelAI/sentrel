class DropComposio < ActiveRecord::Migration[8.0]
  def up
    drop_table :composio_toolkit_caches, if_exists: true

    if column_exists?(:integrations, :composio_connection_id)
      remove_column :integrations, :composio_connection_id, :string
    end

    if column_exists?(:organizations, :composio_api_key_encrypted)
      remove_column :organizations, :composio_api_key_encrypted, :text
    end
  end

  def down
    add_column :organizations, :composio_api_key_encrypted, :text unless column_exists?(:organizations, :composio_api_key_encrypted)
    add_column :integrations, :composio_connection_id, :string unless column_exists?(:integrations, :composio_connection_id)
  end
end
