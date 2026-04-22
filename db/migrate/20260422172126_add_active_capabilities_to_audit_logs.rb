class AddActiveCapabilitiesToAuditLogs < ActiveRecord::Migration[8.0]
  def change
    add_column :audit_logs, :active_capabilities, :jsonb, default: {}, null: false
  end
end
