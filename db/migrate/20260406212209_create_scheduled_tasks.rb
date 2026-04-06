class CreateScheduledTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :scheduled_tasks do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.string :name, null: false
      t.text :instruction, null: false
      t.string :cron_expression, null: false
      t.string :timezone, default: "UTC"
      t.boolean :active, default: true
      t.datetime :last_run_at
      t.datetime :next_run_at

      t.timestamps
    end
  end
end
