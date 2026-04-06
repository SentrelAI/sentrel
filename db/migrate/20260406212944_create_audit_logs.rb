class CreateAuditLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :audit_logs do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, foreign_key: true
      t.string :action, null: false
      t.string :tool_name
      t.jsonb :input, default: {}
      t.jsonb :output, default: {}
      t.string :status

      t.timestamps
    end

    add_index :audit_logs, [:organization_id, :created_at]
    add_index :audit_logs, [:agent_id, :created_at]
  end
end
