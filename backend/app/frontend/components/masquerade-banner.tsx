import { router, usePage } from "@inertiajs/react"
import { ShieldAlert } from "lucide-react"

import type { MasqueradeState } from "@/types"

export function MasqueradeBanner() {
  const { masquerade } = usePage<{ masquerade?: MasqueradeState | null }>().props
  if (!masquerade?.target) return null

  const targetLabel = masquerade.target.name || masquerade.target.email
  const adminLabel = masquerade.admin?.name || masquerade.admin?.email || "admin"

  function stop() {
    router.delete("/masquerade", { preserveScroll: false })
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b-2 border-red-700 bg-red-600 px-4 py-2 text-sm text-white shadow"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0" />
        <span>
          You are masquerading as <b>{targetLabel}</b>
          <span className="ml-2 opacity-80">(signed in as {adminLabel})</span>
        </span>
      </div>
      <button
        onClick={stop}
        className="rounded bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        Stop masquerading
      </button>
    </div>
  )
}
