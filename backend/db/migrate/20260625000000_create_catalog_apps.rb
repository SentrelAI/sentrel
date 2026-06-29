class CreateCatalogApps < ActiveRecord::Migration[8.0]
  def change
    create_table :catalog_apps do |t|
      t.string  :slug, null: false              # Nango provider key (e.g. "github")
      t.string  :label, null: false             # cleaned display name ("GitHub")
      t.string  :display_name                   # raw Nango display_name
      t.string  :category                       # primary, mapped category (sidebar)
      t.jsonb   :categories, null: false, default: []  # all Nango categories
      t.string  :logo                           # logo URL
      t.string  :auth_mode                       # OAUTH2 | API_KEY | ...
      t.string  :api_base_url                    # proxy.base_url
      t.string  :docs_url
      t.jsonb   :scopes, null: false, default: []
      t.jsonb   :modes, null: false, default: [ "managed" ]
      t.string  :tool, null: false, default: "proxy"   # proxy | mcp  (policy)
      t.string  :review, null: false, default: "none"  # none|google|gated (policy)
      t.boolean :featured, null: false, default: false
      t.boolean :published, null: false, default: true # admin gate (hide an app)
      t.integer :position, null: false, default: 0
      t.timestamps
    end
    add_index :catalog_apps, :slug, unique: true
    add_index :catalog_apps, :category
    add_index :catalog_apps, :published
  end
end
