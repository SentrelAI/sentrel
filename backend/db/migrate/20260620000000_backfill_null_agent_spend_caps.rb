# 20260619000000_default_agent_spend_caps set the column DEFAULT for *new*
# agents but deliberately left existing rows NULL (= uncapped). The runaway-
# spend incident showed that uncapped agents are the real exposure: an engine
# loop on an uncapped agent has no ceiling at all. Backfill the legacy NULLs to
# the standard caps so every agent has a safety net. Operators can still raise
# or clear a cap per-agent afterward via the edit form.
class BackfillNullAgentSpendCaps < ActiveRecord::Migration[8.1]
  DEFAULT_DAILY = 15
  DEFAULT_MONTHLY = 150

  def up
    execute(<<~SQL)
      UPDATE agents SET spend_daily_cap_usd = #{DEFAULT_DAILY} WHERE spend_daily_cap_usd IS NULL;
      UPDATE agents SET spend_monthly_cap_usd = #{DEFAULT_MONTHLY} WHERE spend_monthly_cap_usd IS NULL;
    SQL
  end

  def down
    # No-op: we can't tell which rows were intentionally NULL beforehand, and
    # re-NULLing caps would re-open the exposure. Down is intentionally inert.
  end
end
