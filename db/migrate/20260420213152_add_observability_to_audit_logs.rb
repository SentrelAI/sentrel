class AddObservabilityToAuditLogs < ActiveRecord::Migration[8.1]
  # Observability dashboard — capture per-run spans, cost, and timing
  # metrics so we can render waterfall views and aggregate cost analytics.
  #
  # `spans` is an array of { name, start_ms, end_ms, meta } — start/end are
  # ms-since-run-start, meta is freeform JSON per span type.
  def change
    change_table :audit_logs do |t|
      t.jsonb :spans, default: []
      t.decimal :total_cost_usd, precision: 10, scale: 6
      t.integer :input_tokens
      t.integer :output_tokens
      t.integer :duration_ms
      t.integer :first_token_ms # time to first assistant text/tool after prompt sent
      t.string :model_id
      t.string :job_id # correlation ID for cross-referencing
      t.string :conversation_id_ref # renamed from FK-less task_id pattern
    end

    add_index :audit_logs, :duration_ms
    add_index :audit_logs, :total_cost_usd
    add_index :audit_logs, :model_id
    add_index :audit_logs, :job_id
  end
end
