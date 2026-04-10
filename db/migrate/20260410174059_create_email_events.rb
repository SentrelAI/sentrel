class CreateEmailEvents < ActiveRecord::Migration[8.1]
  def change
    create_table :email_events do |t|
      t.references :organization, null: false, foreign_key: true
      t.references :agent, foreign_key: true
      t.string :event_type, null: false
      t.string :recipient
      t.string :bounce_type
      t.string :bounce_subtype
      t.text :diagnostic
      t.jsonb :raw, default: {}

      t.timestamps
    end
    add_index :email_events, [:recipient, :event_type]
  end
end
