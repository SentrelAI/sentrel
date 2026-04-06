class CreateOrganizations < ActiveRecord::Migration[8.1]
  def change
    create_table :organizations do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.string :email_domain
      t.boolean :email_domain_verified, default: false
      t.text :composio_api_key_encrypted

      t.timestamps
    end
    add_index :organizations, :slug, unique: true
  end
end
