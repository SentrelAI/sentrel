class CreateMobileDevices < ActiveRecord::Migration[8.1]
  def change
    create_table :mobile_devices do |t|
      # The opaque bearer token the Expo app sends as `Authorization: Bearer …`
      # on every request. One row per device login — revoking a device is a
      # single DELETE, and a stolen token never exposes the password.
      t.references :user, null: false, foreign_key: true
      t.string :auth_token, null: false
      # Expo push token (ExponentPushToken[…]) used to deliver notifications.
      # Nullable: the row is created at login, the push token arrives once the
      # OS grants notification permission (which may be never).
      t.string :expo_push_token
      t.string :platform              # ios | android | web
      t.string :device_name
      t.datetime :last_seen_at

      t.timestamps
    end

    add_index :mobile_devices, :auth_token, unique: true
    add_index :mobile_devices, :expo_push_token

    # Dedupe guard so the engine's per-run spend_caps#check doesn't fire a
    # "cap exceeded" push on every single run once over the cap — one push
    # per UTC day, reset at midnight (mirrors spend_notified_on semantics).
    add_column :agents, :spend_cap_pushed_on, :date
  end
end
