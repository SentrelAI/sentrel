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

    # Archive dormant conversations daily at 3am
    Thread.new do
      loop do
        now = Time.current
        next_3am = now.change(hour: 3)
        next_3am += 1.day if next_3am <= now
        sleep(next_3am - now)
        ArchiveDormantConversationsJob.perform_later
      rescue => e
        Sidekiq.logger.error "Archive scheduler error: #{e.message}"
      end
    end
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
end
