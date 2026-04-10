class CreateEmailSuppressions < ActiveRecord::Migration[8.1]
  def change
    create_table :email_suppressions do |t|
      t.references :organization, null: false, foreign_key: true
      t.string :email_address, null: false
      t.string :reason, null: false # "hard_bounce", "complaint", "manual"

      t.timestamps
    end
    add_index :email_suppressions, [:organization_id, :email_address], unique: true
  end
end
