# Sweeps Nango-backed integration connections on a schedule, syncing each
# Integration's status with reality (Nango::Health) so broken connections show
# "reconnect" in the UI BEFORE an agent hits them mid-task. Runs every 30 min
# via the Sidekiq cron in config/initializers/sidekiq.rb.
class IntegrationHealthJob < ApplicationJob
  queue_as :default

  def perform
    return unless Nango::Client.configured?
    result = Nango::Health.sweep
    Rails.logger.info "IntegrationHealthJob: #{result.to_json}"
  end
end
