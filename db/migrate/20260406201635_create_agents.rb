class CreateAgents < ActiveRecord::Migration[8.1]
  def change
    create_table :agents do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :manager, foreign_key: { to_table: :agents }, null: true
      t.string :name, null: false
      t.string :slug, null: false
      t.string :role, null: false
      t.string :status, default: "pending", null: false
      t.jsonb :permissions, default: {}
      t.text :identity_md
      t.text :personality_md
      t.text :instructions_md
      t.text :memory_md
      t.boolean :heartbeat_enabled, default: true
      t.integer :heartbeat_interval_minutes, default: 30

      t.timestamps
    end

    add_index :agents, [:organization_id, :slug], unique: true
  end
end
