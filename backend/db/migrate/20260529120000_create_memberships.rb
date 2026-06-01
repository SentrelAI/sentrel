class CreateMemberships < ActiveRecord::Migration[8.1]
  # Join table that lets a single user (one account, one email) belong to many
  # organizations. `users.organization_id` + `users.role` are kept as the
  # user's *active* org context (so acts_as_tenant + every current_user.role
  # check keep working unchanged); this table is the source of truth for which
  # orgs a user can switch into and their role in each.
  def up
    create_table :memberships do |t|
      t.references :user, null: false, foreign_key: true
      t.references :organization, null: false, foreign_key: true
      t.string :role, null: false, default: "member"

      t.timestamps
    end

    add_index :memberships, [ :user_id, :organization_id ], unique: true

    # Backfill one membership per existing user, mirroring their current
    # active org + role so nobody loses access on deploy.
    execute <<~SQL.squish
      INSERT INTO memberships (user_id, organization_id, role, created_at, updated_at)
      SELECT id, organization_id, role, NOW(), NOW()
      FROM users
      ON CONFLICT (user_id, organization_id) DO NOTHING
    SQL
  end

  def down
    drop_table :memberships
  end
end
