Sidekiq.configure_server do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
  config[:concurrency] = Integer(ENV.fetch("SIDEKIQ_CONCURRENCY", "10"))

  # Sidekiq 8 native periodic jobs. Single-source schedule, runs on the
  # leader Sidekiq instance only (no duplicates when scaled), persisted in
  # Redis so a process restart doesn't lose the schedule, visible in the
  # Sidekiq Web UI.
  config.periodic do |mgr|
    mgr.register "* * * * *",   "EmployeeHealthCheckJob"            # every minute
    mgr.register "0 0 * * *",   "DailySummaryJob"                   # midnight
    mgr.register "0 8 * * 1",   "WeeklyDigestJob"                   # Mon 8am
    mgr.register "0 3 * * *",   "ArchiveDormantConversationsJob"    # daily 3am
    mgr.register "*/30 * * * *", "RefreshOauthTokensJob"            # every 30 min
    mgr.register "0 * * * *",   "RefreshComposioCacheJob"           # hourly
  end
end

Sidekiq.configure_client do |config|
  config.redis = { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0") }
end
