class AddParentTaskIdToTasks < ActiveRecord::Migration[8.0]
  def change
    add_reference :tasks, :parent_task, foreign_key: { to_table: :tasks }, null: true
    add_index :tasks, [:parent_task_id, :status], name: "index_tasks_on_parent_and_status"
  end
end
