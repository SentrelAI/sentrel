class CreateTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :tasks do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.references :assigned_by_user, foreign_key: { to_table: :users }, null: true
      t.references :assigned_by_agent, foreign_key: { to_table: :agents }, null: true
      t.string :title, null: false
      t.text :description
      t.text :instruction
      t.string :status, default: "todo", null: false
      t.string :priority, default: "normal", null: false
      t.jsonb :result, default: {}
      t.datetime :due_at
      t.datetime :started_at
      t.datetime :completed_at

      t.timestamps
    end

    add_index :tasks, [:agent_id, :status]
  end
end
