# Centralizes the (all public, client-side) analytics + monitoring config.
#
# Everything here is opt-in via env vars — matching the Sentry backend
# initializer (config/initializers/sentry.rb) — so nothing loads locally or
# in CI unless the matching key is set. Keys are injected into the page at
# request time rather than baked into the Vite build, so the same Docker
# image works across environments and rotating a key needs no rebuild. Every
# value here is public by design (it ships to the browser), so rendering it
# inline is safe.
module AnalyticsHelper
  # Never load third-party analytics under test (keeps specs hermetic) — and
  # gives a single switch if we ever want to disable it wholesale.
  def analytics_enabled?
    !Rails.env.test?
  end

  # Plausible — the site domain registered in your Plausible dashboard
  # (e.g. "double.md"). Self-hosted / proxied installs can point at a custom
  # script URL via PLAUSIBLE_SRC.
  def plausible_domain
    ENV["PLAUSIBLE_DOMAIN"].presence
  end

  def plausible_script_src
    ENV.fetch("PLAUSIBLE_SRC", "https://plausible.io/js/script.js")
  end

  # Google Analytics 4 measurement id, e.g. "G-XXXXXXXXXX".
  def ga_measurement_id
    ENV["GA_MEASUREMENT_ID"].presence
  end

  # Config consumed by the JS entrypoint (app/frontend/lib/analytics.ts):
  # PostHog (product analytics) + the browser-side Sentry SDK. Each sub-hash
  # is omitted when unconfigured, so the client treats that provider as off.
  def client_analytics_config
    config = {}

    if (posthog_key = ENV["POSTHOG_KEY"].presence)
      config[:posthog] = {
        key: posthog_key,
        host: ENV.fetch("POSTHOG_HOST", "https://us.i.posthog.com")
      }
    end

    if (sentry_dsn = ENV["SENTRY_FRONTEND_DSN"].presence)
      config[:sentry] = {
        dsn: sentry_dsn,
        environment: Rails.env.to_s,
        release: ENV.fetch("GIT_SHA", "dev"),
        tracesSampleRate: ENV.fetch("SENTRY_TRACES_RATE", "0.1").to_f
      }
    end

    config
  end

  # Renders the client config as an inert JSON island the entrypoint reads.
  # `<script type="application/json">` is raw-text (the browser never executes
  # it and never decodes HTML entities inside it), so we json-escape `<`, `>`,
  # `&` to their \uXXXX forms — that both keeps the JSON valid for
  # JSON.parse(textContent) and makes a "</script>" breakout impossible.
  def analytics_config_script_tag
    config = client_analytics_config
    return if config.empty?

    # json_escape neutralizes <, >, & (and U+2028/2029) into \uXXXX so the
    # blob can't break out of the <script>; escape:false then emits it
    # verbatim (the tag builder still returns an html-safe buffer).
    json = ERB::Util.json_escape(config.to_json)
    tag.script(json, type: "application/json", id: "analytics-config", escape: false)
  end
end
