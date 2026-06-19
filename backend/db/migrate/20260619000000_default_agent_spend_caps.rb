# Set default spend caps for new agents: $15/day, $150/month. Only affects
# rows inserted after this runs — existing agents keep their current caps
# (including NULL = uncapped). Templates and the edit form still override.
class DefaultAgentSpendCaps < ActiveRecord::Migration[8.1]
  def change
    change_column_default :agents, :spend_daily_cap_usd, from: nil, to: 15
    change_column_default :agents, :spend_monthly_cap_usd, from: nil, to: 150
  end
end
