class CreateChannelConfigs < ActiveRecord::Migration[8.1]
  def change
    create_table :channel_configs do |t|
      t.references :agent, null: false, foreign_key: true
      t.string :channel_type, null: false
      t.boolean :enabled, default: true
      t.jsonb :config, default: {}
      t.string :status, default: "disconnected", null: false

      t.timestamps
    end

    add_index :channel_configs, [:agent_id, :channel_type], unique: true
  end
end
