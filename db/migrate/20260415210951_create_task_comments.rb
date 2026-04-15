class CreateTaskComments < ActiveRecord::Migration[8.1]
  def change
    create_table :task_comments do |t|
      t.references :task, null: false, foreign_key: true
      t.references :agent, foreign_key: true
      t.references :user, foreign_key: true
      t.text :content, null: false
      t.timestamps
    end
  end
end
