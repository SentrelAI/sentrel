Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }

  config.on(:startup) do
    # Run health check every 30 seconds
    Sidekiq.logger.info "Starting periodic health check..."
    Thread.new do
      loop do
        sleep 30
        EmployeeHealthCheckJob.perform_later
      rescue => e
        Sidekiq.logger.error "Health check error: #{e.message}"
      end
    end

    # Poll outbound email queue every 10 seconds
    Sidekiq.logger.info "Starting outbound email poller..."
    Thread.new do
      loop do
        sleep 10
        OutboundEmailPollerJob.perform_later
      rescue => e
        Sidekiq.logger.error "Email poller error: #{e.message}"
      end
    end
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
end
