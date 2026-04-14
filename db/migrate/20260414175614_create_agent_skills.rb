class CreateAgentSkills < ActiveRecord::Migration[8.1]
  def change
    create_table :agent_skills do |t|
      t.references :agent, null: false, foreign_key: true
      t.references :skill_definition, null: false, foreign_key: true
      t.boolean :enabled, default: true
      t.jsonb :config, default: {}

      t.timestamps
    end
    add_index :agent_skills, [:agent_id, :skill_definition_id], unique: true, name: "idx_agent_skills_unique"
  end
end
