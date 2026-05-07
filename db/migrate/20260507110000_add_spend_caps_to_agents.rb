class AddSpendCapsToAgents < ActiveRecord::Migration[8.1]
  # Per-agent spend caps. Stored on the agents table directly (vs a separate
  # join) because the read path is hot (engine consults before every run)
  # and there's only one cap config per agent. Nullable everywhere → cap
  # disabled by default; the engine treats a null cap as "no limit."
  def change
    change_table :agents, bulk: true do |t|
      t.decimal :spend_daily_cap_usd, precision: 10, scale: 2
      t.decimal :spend_monthly_cap_usd, precision: 10, scale: 2
      # 0.0–1.0 fraction. When today's spend crosses this fraction of the
      # daily cap, the engine posts a one-time-per-day "approaching cap"
      # heads-up to the conversation. Default 0.8 (80%).
      t.decimal :spend_notify_threshold_pct, precision: 4, scale: 2, default: 0.8, null: false
      # Whether a notify message has been posted today — reset by the engine
      # at UTC midnight before the next consult. Persists so multiple Fly
      # machine restarts don't double-notify.
      t.date :spend_notified_on
    end
  end
end
