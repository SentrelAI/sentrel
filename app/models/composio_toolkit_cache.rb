# Durable cache of Composio's toolkit catalog + per-org availability.
# Hot-path reads come from this table — no HTTP to Composio during page
# render or agent boot. Refreshed by RefreshComposioCacheJob (hourly cron
# + on-demand from /integrations).
class ComposioToolkitCache < ApplicationRecord
  belongs_to :organization

  scope :available, -> { where(available: true) }
end
