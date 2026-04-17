class CreateScheduledWork < ActiveRecord::Migration[8.1]
  # Step 5 — one table for cron, one-shot, and interval jobs.
  # Replaces `scheduled_tasks` (cron only) + ad-hoc BullMQ delayed reminders +
  # heartbeat.ts (in-memory interval). After a 1-week dual-write window,
  # `scheduled_tasks` and `heartbeat.ts` can be dropped.
  def change
    create_table :scheduled_work do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.string :mode, null: false           # "cron" | "once" | "interval"
      t.string :name, null: false
      t.text :instruction, null: false
      t.string :cron_expression              # mode=cron only
      t.string :timezone, default: "UTC"
      t.datetime :fire_at                    # mode=once only (absolute datetime)
      t.integer :interval_seconds            # mode=interval only
      t.boolean :active, default: true, null: false
      t.datetime :last_run_at
      t.datetime :next_run_at
      t.jsonb :payload_extra, default: {}    # channel metadata for reminders, etc.
      t.timestamps
    end

    add_index :scheduled_work, [:agent_id, :mode, :active]
    add_index :scheduled_work, [:fire_at], where: "mode = 'once' AND active = true"
  end
end
