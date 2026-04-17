class ExtendAuditLogsForObservability < ActiveRecord::Migration[8.1]
  # Extra L — surface fields that currently live only inside output jsonb so
  # we can index/aggregate them. Enables measuring cache hit rate, toolkit
  # routing accuracy, and tying audit rows to tasks for per-task audit trails.
  def change
    change_table :audit_logs do |t|
      t.jsonb :routed_toolkits, default: []
      t.references :task, foreign_key: true, null: true
      t.boolean :was_resume, default: false, null: false
      t.integer :cache_read_input_tokens
      t.integer :cache_creation_input_tokens
    end

    add_index :audit_logs, :was_resume
    add_index :audit_logs, :routed_toolkits, using: :gin
  end
end
