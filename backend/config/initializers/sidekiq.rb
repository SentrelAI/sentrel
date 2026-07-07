Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
  config[:concurrency] = Integer(ENV.fetch("SIDEKIQ_CONCURRENCY", "10"))

  # Periodic jobs via sidekiq-cron (OSS — Sidekiq's own `config.periodic` is
  # Enterprise-only). Schedule is loaded once on server boot; sidekiq-cron
  # uses Redis as the lock so only one instance fires the job per tick even
  # when Sidekiq scales out. Visible in the Sidekiq Web UI under "Cron".
  config.on(:startup) do
    schedule = {
      "EmployeeHealthCheckJob"           => { "cron" => "* * * * *",   "class" => "EmployeeHealthCheckJob" },           # every minute
      "DailySummaryJob"                  => { "cron" => "0 0 * * *",   "class" => "DailySummaryJob" },                  # midnight
      "WeeklyDigestJob"                  => { "cron" => "0 8 * * 1",   "class" => "WeeklyDigestJob" },                  # Mon 8am
      "ArchiveDormantConversationsJob"   => { "cron" => "0 3 * * *",   "class" => "ArchiveDormantConversationsJob" },   # daily 3am
      "RefreshOauthTokensJob"            => { "cron" => "*/30 * * * *", "class" => "RefreshOauthTokensJob" },           # every 30 min
      "IntegrationHealthJob"             => { "cron" => "*/30 * * * *", "class" => "IntegrationHealthJob" },            # every 30 min — Nango connection health
      "CatalogSyncJob"                   => { "cron" => "0 4 * * *",   "class" => "CatalogSyncJob" },                  # daily 4am — refresh app directory from Nango /providers
      "MetaFblRefreshJob"                => { "cron" => "30 5 * * *",  "class" => "MetaFblRefreshJob" },               # daily 5:30am — refresh FLB 60-day Meta tokens (no-op unless META_FBL_ENABLED)
      # Wake stopped agent machines ~30s before their scheduled work is due.
      # Fly auto-start only fires on HTTP traffic; our engine consumes Redis,
      # so a delayed BullMQ job in a sleeping machine never fires on its own.
      # This sweep finds scheduled_work due within 90s and pokes the machine
      # via the Fly API. See WakeSweepJob + docs in scheduled work flow.
      "WakeSweepJob"                     => { "cron" => "* * * * *",   "class" => "WakeSweepJob" },                    # every minute
      # Engine-version-independent backstop against runaway schedules: watches
      # the audit trail and deactivates any scheduled_work row whose fire count
      # is impossible for a healthy row (see ScheduledWorkCircuitBreakerJob).
      "ScheduledWorkCircuitBreakerJob"   => { "cron" => "* * * * *",   "class" => "ScheduledWorkCircuitBreakerJob" }   # every minute
    }
    Sidekiq::Cron::Job.load_from_hash!(schedule)
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
end
