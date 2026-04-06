class CreateIntegrations < ActiveRecord::Migration[8.1]
  def change
    create_table :integrations do |t|
      t.references :organization, null: false, foreign_key: true
      t.string :service_name, null: false
      t.string :composio_connection_id
      t.string :status, default: "connected", null: false
      t.string :scopes, array: true, default: []

      t.timestamps
    end

    add_index :integrations, [:organization_id, :service_name]
  end
end
