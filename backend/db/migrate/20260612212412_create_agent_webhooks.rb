class CreateAgentWebhooks < ActiveRecord::Migration[8.1]
  def change
    create_table :agent_webhooks do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.string :name, null: false
      # The URL credential — long random urlsafe token; possession = permission to post.
      t.string :token, null: false, index: { unique: true }
      # What the agent should DO when a payload arrives. The (summarized)
      # payload is appended to this instruction at dispatch.
      t.text :instruction, null: false
      # Source hint (github | sentry | linear | stripe | generic …) for UI
      # badges and payload summarization.
      t.string :source, default: "generic", null: false
      t.boolean :active, default: true, null: false
      t.integer :receive_count, default: 0, null: false
      t.datetime :last_received_at

      t.timestamps
    end
  end
end
