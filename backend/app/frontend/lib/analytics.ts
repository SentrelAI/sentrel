// Browser-side analytics + error monitoring, wired to the env-gated config
// the Rails layout injects (see AnalyticsHelper + layouts/_analytics.html.erb).
// Each provider is independent and inert until its key is present, so this is
// a no-op in dev/CI unless explicitly configured.
//
// Pageview model on this Inertia SPA:
//   • Plausible + GA4 auto-track History API navigations (their scripts live
//     in the document <head>), so we do NOT fire those manually here.
//   • PostHog is initialized with capture_pageview:false; we emit a $pageview
//     on initial load + every Inertia `navigate`, deduped by URL so all three
//     providers stay 1:1.
import * as Sentry from "@sentry/react"
import posthog from "posthog-js"

interface PosthogConfig {
  key: string
  host: string
}

interface SentryConfig {
  dsn: string
  environment: string
  release: string
  tracesSampleRate: number
}

interface AnalyticsConfig {
  posthog?: PosthogConfig
  sentry?: SentryConfig
}

interface IdentifyUser {
  id: string
  email?: string
  name?: string
  role?: string
}

interface IdentifyOrg {
  id: number | string
  name?: string
  slug?: string
}

let posthogReady = false
let lastTrackedUrl: string | null = null

function readConfig(): AnalyticsConfig {
  const el = document.getElementById("analytics-config")
  if (!el?.textContent) return {}
  try {
    return JSON.parse(el.textContent) as AnalyticsConfig
  } catch {
    return {}
  }
}

// Boot the JS-side providers. Safe to call once, before the app mounts.
export function initAnalytics(): void {
  const config = readConfig()

  if (config.sentry) {
    Sentry.init({
      dsn: config.sentry.dsn,
      environment: config.sentry.environment,
      release: config.sentry.release,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: config.sentry.tracesSampleRate,
      sendDefaultPii: false,
    })
  }

  if (config.posthog) {
    posthog.init(config.posthog.key, {
      api_host: config.posthog.host,
      // We drive pageviews from Inertia navigation (see trackPageview).
      capture_pageview: false,
      capture_pageleave: true,
      // Only build person profiles for users we explicitly identify.
      person_profiles: "identified_only",
    })
    posthogReady = true
  }
}

// Record a PostHog pageview, deduped by URL. Consecutive same-URL calls are
// dropped — this kills the initial-load double when Inertia's `navigate` also
// fires for the first page. Plausible/GA track their own SPA pageviews.
export function trackPageview(url?: string): void {
  const path = url ?? window.location.pathname + window.location.search
  if (path === lastTrackedUrl) return
  lastTrackedUrl = path
  if (posthogReady) posthog.capture("$pageview")
}

// Mirror the logged-in user into PostHog + Sentry, or clear it on logout.
// Called from the entrypoint with Inertia's shared `auth` props. Identify is
// idempotent, so calling this on every navigation is fine.
export function syncIdentity(
  user: IdentifyUser | null | undefined,
  org?: IdentifyOrg | null,
): void {
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email })
    if (posthogReady) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
        role: user.role,
      })
      if (org) {
        posthog.group("organization", String(org.id), {
          name: org.name,
          slug: org.slug,
        })
      }
    }
  } else {
    Sentry.setUser(null)
    if (posthogReady) posthog.reset()
  }
}
