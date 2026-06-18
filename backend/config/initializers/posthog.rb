require "posthog"

posthog = PostHog::Client.new({
  api_key: "phc_sC3u9YBwU24EjpAheuHNtxJ4NTWudgZ8Bv66La8ddUBW",
  host: "https://us.i.posthog.com",
  on_error: Proc.new { |status, msg| print msg }
})
