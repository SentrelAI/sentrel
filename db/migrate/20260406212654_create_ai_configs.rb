class CreateAiConfigs < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_configs do |t|
      t.references :agent, null: false, foreign_key: true, index: { unique: true }
      t.string :provider, default: "anthropic", null: false
      t.string :model_id, default: "claude-sonnet-4-20250514", null: false
      t.decimal :temperature, precision: 3, scale: 2, default: 0.7
      t.integer :max_tokens, default: 8192
      t.string :thinking_level, default: "none"

      t.timestamps
    end

  end
end
