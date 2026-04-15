if ENV["SENTRY_DSN"].present?
  Sentry.init do |config|
    config.dsn = ENV["SENTRY_DSN"]
    config.environment = Rails.env
    config.release = ENV.fetch("GIT_SHA", "dev")

    config.breadcrumbs_logger = [:active_support_logger, :http_logger]
    config.traces_sample_rate = ENV.fetch("SENTRY_TRACES_RATE", "0.1").to_f
    config.profiles_sample_rate = ENV.fetch("SENTRY_PROFILES_RATE", "0.1").to_f

    config.send_default_pii = false

    # Scrub sensitive params
    config.before_send = lambda do |event, _hint|
      event.request&.data&.except!("password", "access_token", "refresh_token", "api_key")
      event
    end

    # Tag every event with org + agent when available
    config.before_send_transaction = lambda do |event, _hint|
      event
    end
  end
end
