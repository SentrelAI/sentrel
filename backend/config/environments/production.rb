require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Prepare the ingress controller used to receive mail
  # config.action_mailbox.ingress = :relay

  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # Turn on fragment caching in view templates.
  config.action_controller.perform_caching = true

  # Cache assets for far-future expiry since they are all digest stamped.
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # Enable serving of images, stylesheets, and JavaScripts from an asset server.
  # config.asset_host = "http://assets.example.com"

  # Store uploaded files in S3 in prod. Bucket = $ACTIVE_STORAGE_S3_BUCKET
  # (default "alchemy-prod") in $AWS_REGION (default us-east-1).
  config.active_storage.service = :amazon

  # Assume all access to the app is happening through a SSL-terminating reverse proxy.
  # config.assume_ssl = true

  # Force all access to the app over SSL, use Strict-Transport-Security, and use secure cookies.
  # config.force_ssl = true

  # Skip http-to-https redirect for the default health check endpoint.
  # config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]

  # Better Stack logging via logtail-rails (opt-in via BETTERSTACK_SOURCE_TOKEN)
  if ENV["BETTERSTACK_SOURCE_TOKEN"].present? && defined?(Logtail)
    config.logger = Logtail::Logger.create_default_logger(ENV["BETTERSTACK_SOURCE_TOKEN"])
  else
    config.logger = ActiveSupport::TaggedLogging.logger(STDOUT)
  end

  # Change to "debug" to log everything (including potentially personally-identifiable information!).
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Redis cache store (same Redis as Sidekiq, ActionCable, and engine queue)
  config.cache_store = :redis_cache_store, { url: ENV.fetch("REDIS_URL", "redis://localhost:6379/1") }

  # Deliver mail through AWS SES (see config/initializers/action_mailer_ses.rb),
  # reusing the same AWS credentials as the agent email channel.
  config.action_mailer.delivery_method = :ses
  config.action_mailer.perform_deliveries = true
  # Raise on delivery failure so the Sidekiq job (deliver_later) retries
  # transient SES errors instead of silently dropping the message.
  config.action_mailer.raise_delivery_errors = true

  # Host used by links generated in mailer templates (invitation accept links, etc.).
  config.action_mailer.default_url_options = {
    host: ENV.fetch("APP_HOST", "sentrel.ai"),
    protocol: "https"
  }

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

  # Allow the production domain and any subdomains.
  config.hosts << "sentrel.ai"
  config.hosts << /.*\.sentrel\.ai/

  # Kamal-proxy health checks hit `/up` using the container's internal
  # hostname (e.g. `d721da4f4556:80`), which HostAuthorization would
  # otherwise 403. Exempt `/up` from the check so deploys can succeed.
  config.host_authorization = { exclude: ->(request) { request.path == "/up" } }
end
