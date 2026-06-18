import type { ResolvedComponent } from "@inertiajs/react"
import { createInertiaApp } from "@inertiajs/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import PersistentLayout from "@/layouts/persistent-layout"

void createInertiaApp({
  title: (title) => (title ? `${title} - Sentrel` : "Sentrel"),

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
