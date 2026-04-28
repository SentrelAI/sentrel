class CreateComposioToolkitCaches < ActiveRecord::Migration[8.0]
  def change
    create_table :composio_toolkit_caches do |t|
      t.belongs_to :organization, null: false, foreign_key: true
      t.string :slug, null: false
      t.string :label
      t.string :logo
      t.text   :description
      t.string :category
      t.boolean :available, default: false, null: false
      t.datetime :refreshed_at, null: false
      t.timestamps
    end

    add_index :composio_toolkit_caches, [:organization_id, :slug], unique: true,
              name: "idx_composio_toolkit_caches_org_slug"
    add_index :composio_toolkit_caches, [:organization_id, :available]
  end
end
