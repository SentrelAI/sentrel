class CreateSkillDefinitions < ActiveRecord::Migration[8.1]
  def change
    create_table :skill_definitions do |t|
      t.string :slug
      t.string :name
      t.string :description
      t.string :category
      t.text :skill_md
      t.jsonb :requires_connections, default: []
      t.string :icon
      t.string :source, default: "built_in"

      t.timestamps
    end
    add_index :skill_definitions, :slug, unique: true
  end
end
