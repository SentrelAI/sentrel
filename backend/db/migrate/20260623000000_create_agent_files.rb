class CreateAgentFiles < ActiveRecord::Migration[8.0]
  def change
    create_table :agent_files do |t|
      t.references :organization, null: false, foreign_key: true
      # Null agent_id = org-shared file (visible to every agent in the org).
      # Set agent_id = personal file (visible only to that agent).
      t.references :agent, null: true, foreign_key: true
      t.string :scope, null: false, default: "agent"
      t.string :title, null: false
      t.text   :description

      t.timestamps
    end

    add_index :agent_files, [ :organization_id, :agent_id ]
    add_index :agent_files, [ :organization_id, :scope ]
  end
end
