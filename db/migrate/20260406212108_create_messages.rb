class CreateMessages < ActiveRecord::Migration[8.1]
  def change
    create_table :messages do |t|
      t.references :conversation, null: false, foreign_key: true
      t.string :role, null: false
      t.text :content, null: false
      t.string :direction
      t.string :channel
      t.jsonb :tool_calls, default: []
      t.jsonb :metadata, default: {}

      t.timestamps
    end

    add_index :messages, [:conversation_id, :created_at]
  end
end
