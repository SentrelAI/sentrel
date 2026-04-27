Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
  config[:concurrency] = Integer(ENV.fetch("SIDEKIQ_CONCURRENCY", "10"))

  config.on(:startup) do
    # Run health check every 60 seconds (was 30, reduced spam)
    Sidekiq.logger.info "Starting periodic health check..."
    Thread.new do
      loop do
        sleep 60
        EmployeeHealthCheckJob.perform_later
      rescue => e
        Sidekiq.logger.error "Health check error: #{e.message}"
      end
    end

    # Daily summary job at midnight
    Thread.new do
      loop do
        now = Time.current
        next_midnight = now.change(hour: 0) + 1.day
        sleep(next_midnight - now)
        DailySummaryJob.perform_later
      rescue => e
        Sidekiq.logger.error "Daily summary scheduler error: #{e.message}"
      end
    end

    # Weekly digest every Monday at 8am
    Thread.new do
      loop do
        now = Time.current
        next_monday_8am = now.beginning_of_week(:monday).change(hour: 8)
        next_monday_8am += 1.week if next_monday_8am <= now
        sleep(next_monday_8am - now)
        WeeklyDigestJob.perform_later
      rescue => e
        Sidekiq.logger.error "Weekly digest scheduler error: #{e.message}"
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

    # Refresh subscription OAuth tokens (Anthropic/OpenAI accounts) every
    # 30 min — handles ones expiring inside the next hour. After refresh the
    # job pushes the new env to Fly Machines so engines pick it up live.
    Thread.new do
      loop do
        sleep 30 * 60
        RefreshOauthTokensJob.perform_later
      rescue => e
        Sidekiq.logger.error "OAuth refresh scheduler error: #{e.message}"
      end
    end
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
end
