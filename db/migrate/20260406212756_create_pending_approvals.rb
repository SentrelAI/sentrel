class CreatePendingApprovals < ActiveRecord::Migration[8.1]
  def change
    create_table :pending_approvals do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.references :reviewed_by, foreign_key: { to_table: :users }, null: true
      t.string :tool_name, null: false
      t.jsonb :tool_input, default: {}
      t.text :context
      t.string :status, default: "pending", null: false
      t.datetime :reviewed_at

      t.timestamps
    end

    add_index :pending_approvals, [:organization_id, :status]
  end
end
