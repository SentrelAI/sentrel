import { Head, Link } from "@inertiajs/react"
import { useMemo, useState } from "react"
import { Bot, Search, Sparkles, Star, Upload, Users } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Source = "all" | "system" | "community" | "mine"

interface Template {
  slug: string
  name: string
  role: string
  description: string | null
  icon: string | null
  category: string | null
  capabilities: Record<string, { enabled?: boolean   featured?: boolean
  featured_position?: number | null
}>
  suggested_skill_slugs: string[]
  install_count: number
  published: boolean
  system_template: boolean
  author_name: string
  owned_by_me: boolean
}

interface Props {
  templates: Template[]
  categories: string[]
}

const CATEGORY_LABEL: Record<string, string> = {
  starter:     "Starters",
  sales:       "Sales",
  support:     "Support",
  marketing:   "Marketing",
  engineering: "Engineering",
  people:      "People",
  personal:    "Personal",
  ops:         "Ops",
}

export default function TemplatesIndex({ templates, categories }: Props) {
  const [query, setQuery] = useState("")
  const [source, setSource] = useState<Source>("all")

  const filtered = useMemo(() => {
    let rows = templates
    if (source === "system")    rows = rows.filter((t) => t.system_template)
    if (source === "community") rows = rows.filter((t) => !t.system_template)
    if (source === "mine")      rows = rows.filter((t) => t.owned_by_me)
    if (query.trim()) {
      const q = query.toLowerCase()
      rows = rows.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.role.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q),
      )
    }
    return rows
  }, [templates, source, query])

  // Curated highlights above the category groups — same row the public
  // gallery shows, so featured placement is consistent inside and out.
  const featured = useMemo(() => {
    return filtered
      .filter((t) => t.featured)
      .sort((a, b) => {
        const pa = a.featured_position ?? Number.MAX_SAFE_INTEGER
        const pb = b.featured_position ?? Number.MAX_SAFE_INTEGER
        return pa - pb || a.name.localeCompare(b.name)
      })
  }, [filtered])

  // Group by category for the rendered grid, in the order defined by `categories`.
  const grouped = useMemo(() => {
    const g: Record<string, Template[]> = {}
    for (const t of filtered) {
      const key = t.category || "starter"
      ;(g[key] ||= []).push(t)
    }
    return g
  }, [filtered])

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Templates" },
      ]}
    >
      <Head title="Agent Templates" />

      <PageHeader
        eyebrow="Library"
        title="Agent templates"
        description="Pre-built roles you can hire in one click — and your own templates saved from existing agents."
        action={
          <Link href="/agent_templates/import">
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Upload className="size-3.5" />
              Import from JSON
            </Button>
          </Link>
        }
      />

      <div className="max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by role, name, or description…"
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-card p-1">
            {(["all", "system", "community", "mine"] as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  source === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s === "system" ? "System" : s === "community" ? "Community" : "Mine"}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No templates match your filter.
            </CardContent>
          </Card>
        ) : (<>
          {featured.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Star className="size-3.5 fill-current text-amber-500" />
                Featured
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {featured.map((t) => (
                  <TemplateCard key={`featured-${t.slug}`} t={t} />
                ))}
              </div>
            </section>
          )}
          {categories.map((cat) => {
            const items = grouped[cat]
            if (!items || items.length === 0) return null
            return (
              <section key={cat}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {CATEGORY_LABEL[cat] ?? cat}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((t) => (
                    <TemplateCard key={t.slug} t={t} />
                  ))}
                </div>
              </section>
            )
          })}
        </>)}
      </div>
    </AppLayout>
  )
}

function TemplateCard({ t }: { t: Template }) {
  return (
    <Link href={`/agent_templates/${t.slug}`} className="block group">
      <Card className="h-full transition-colors group-hover:border-foreground/40">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                <Bot className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{t.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">{t.role}</div>
              </div>
            </div>
            {t.system_template ? (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Sparkles className="size-3" />
                System
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Users className="size-3" />
                Community
              </Badge>
            )}
          </div>
          {t.description && (
            <p className="text-xs text-muted-foreground line-clamp-3">{t.description}</p>
          )}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/50">
            <span>by {t.author_name}</span>
            {t.install_count > 0 && <span>{t.install_count} installs</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
