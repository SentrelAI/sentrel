class AddPlatformAdminToUsers < ActiveRecord::Migration[8.0]
  def up
    add_column :users, :platform_admin, :boolean, default: false, null: false
    add_index :users, :platform_admin, where: "platform_admin = true"

    # Bootstrap: anyone listed in PLATFORM_ADMIN_EMAILS (during the
    # interim env-var phase) gets promoted automatically. Plus the
    # canonical ScribeMD operator emails so the migration works even
    # without the env var set.
    bootstrap_emails = (
      ENV["PLATFORM_ADMIN_EMAILS"].to_s.split(",") +
      %w[abdel@scribemd.ai elie@scribemd.ai elie.toubiana@gmail.com]
    ).map { |e| e.strip.downcase }.reject(&:empty?).uniq

    if bootstrap_emails.any?
      # Use UPDATE so we don't trigger model callbacks.
      execute <<~SQL
        UPDATE users SET platform_admin = true
        WHERE LOWER(email) IN (#{bootstrap_emails.map { |e| ActiveRecord::Base.connection.quote(e) }.join(", ")})
      SQL
    end
  end

  def down
    remove_index  :users, :platform_admin
    remove_column :users, :platform_admin
  end
end
