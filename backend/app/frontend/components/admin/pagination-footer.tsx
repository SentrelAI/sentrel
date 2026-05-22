import { router } from "@inertiajs/react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export interface PagyMeta {
  page: number
  pages: number
  count: number
  per_page: number
  from: number | null
  to: number | null
}

interface Props {
  pagy: PagyMeta
  basePath: string
  // Other URL params to preserve when navigating between pages
  // (e.g. { q: "claude", category: "ops" }).
  query?: Record<string, string | number | undefined>
  perPageOptions?: number[]
}

const DEFAULT_PER_PAGE_OPTIONS = [25, 50, 100, 200]

export default function PaginationFooter({
  pagy,
  basePath,
  query = {},
  perPageOptions = DEFAULT_PER_PAGE_OPTIONS,
}: Props) {
  function go(nextPage: number, nextPerPage?: number) {
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && String(v).length > 0) params[k] = String(v)
    }
    if (nextPage > 1) params.page = String(nextPage)
    if (nextPerPage && nextPerPage !== 50) params.per_page = String(nextPerPage)
    router.get(basePath, params, { preserveScroll: true, preserveState: true })
  }

  if (pagy.count === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span>No results.</span>
      </div>
    )
  }

  const canPrev = pagy.page > 1
  const canNext = pagy.page < pagy.pages

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs">
      <div className="text-muted-foreground">
        Showing <span className="font-medium text-foreground">{pagy.from}–{pagy.to}</span> of{" "}
        <span className="font-medium text-foreground">{pagy.count}</span>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-muted-foreground">
          Per page
          <select
            value={pagy.per_page}
            onChange={(e) => go(1, Number(e.target.value))}
            className="rounded border bg-background px-1 py-0.5 text-xs"
          >
            {perPageOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            onClick={() => canPrev && go(pagy.page - 1)}
            disabled={!canPrev}
            className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 disabled:opacity-40"
            title="Previous page"
          >
            <ChevronLeft className="size-3" />
          </button>
          <span className="text-muted-foreground">
            Page <span className="font-medium text-foreground">{pagy.page}</span> of {pagy.pages}
          </span>
          <button
            onClick={() => canNext && go(pagy.page + 1)}
            disabled={!canNext}
            className="inline-flex items-center rounded border bg-background px-1.5 py-0.5 disabled:opacity-40"
            title="Next page"
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
