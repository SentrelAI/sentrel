class CreateConversations < ActiveRecord::Migration[8.1]
  def change
    create_table :conversations do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, null: false, foreign_key: true
      t.references :user, foreign_key: true, null: true
      t.string :kind, default: "external", null: false
      t.string :contact_name
      t.string :contact_email
      t.string :contact_phone
      t.string :contact_identifier
      t.string :subject
      t.string :status, default: "active", null: false

      t.timestamps
    end

    add_index :conversations, [:agent_id, :contact_identifier]
    add_index :conversations, [:agent_id, :kind]
  end
end
