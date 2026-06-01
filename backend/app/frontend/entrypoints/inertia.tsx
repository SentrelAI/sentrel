import type { ResolvedComponent } from "@inertiajs/react"
import { createInertiaApp, router } from "@inertiajs/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import PersistentLayout from "@/layouts/persistent-layout"
import { initAnalytics, syncIdentity, trackPageview } from "@/lib/analytics"
import type { SharedProps } from "@/types"

// Boot analytics/monitoring before the app mounts (no-op unless configured).
initAnalytics()

// Re-identify + count a PostHog pageview on every Inertia navigation. The
// initial load is handled in setup() below; trackPageview dedupes by URL so
// the two never double-count. Plausible/GA track SPA navigations themselves.
router.on("navigate", (event) => {
  const shared = event.detail.page.props as unknown as SharedProps
  syncIdentity(shared.auth?.user, shared.auth?.organization)
  trackPageview(event.detail.page.url)
})

void createInertiaApp({
  title: (title) => (title ? `${title} - Double.md` : "Double.md"),

  resolve: (name) => {
    const pages = import.meta.glob<{ default: ResolvedComponent }>(
      "../pages/**/*.tsx",
      { eager: true }
    )
    const page = pages[`../pages/${name}.tsx`]
    if (!page) {
      console.error(`Missing Inertia page component: '${name}.tsx'`)
    }
    page.default.layout ??= [PersistentLayout]
    return page
  },

  setup({ el, App, props }) {
    // Initial identify + pageview from the first server-rendered page props.
    const shared = props.initialPage.props as unknown as SharedProps
    syncIdentity(shared.auth?.user, shared.auth?.organization)
    trackPageview(props.initialPage.url)

    createRoot(el).render(
      <StrictMode>
        <App {...props} />
      </StrictMode>
    )
  },

  defaults: {
    form: {
      forceIndicesArrayFormatInFormData: false,
      withAllErrors: true,
    },
  },

  progress: {
    color: "#4B5563",
  },
}).catch((error) => {
  if (document.getElementById("app")) {
    throw error
  }
})
