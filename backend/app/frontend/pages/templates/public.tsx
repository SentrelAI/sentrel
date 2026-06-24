import { Head } from "@inertiajs/react"
import { useMemo, useState } from "react"
import { Search, Star } from "lucide-react"

import { Overline } from "@/components/brand"
import { Input } from "@/components/ui/input"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { TemplateDeployCard, type DeployTemplate } from "@/components/template-deploy-card"

interface Props {
  templates: DeployTemplate[]
  categories: string[]
}

const CATEGORY_LABEL: Record<string, string> = {
  starter: "Starters",
  sales: "Sales",
  support: "Support",
  marketing: "Marketing",
  engineering: "Engineering",
  people: "People",
  personal: "Personal",
  ops: "Ops",
}

export default function TemplatesPublic({ templates, categories }: Props) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((t) =>
      [t.name, t.role, t.description || ""].join(" ").toLowerCase().includes(q),
    )
  }, [templates, query])

  // Curated highlights, shown in their own row above the category groups.
  // Ordered by featured_position (nulls last), then name. Respects search.
  const featured = useMemo(() => {
    return filtered
      .filter((t) => t.featured)
      .sort((a, b) => {
        const pa = a.featured_position ?? Number.MAX_SAFE_INTEGER
        const pb = b.featured_position ?? Number.MAX_SAFE_INTEGER
        return pa - pb || a.name.localeCompare(b.name)
      })
  }, [filtered])

  // Group by category, rendered in the canonical category order.
  const grouped = useMemo(() => {
    const g: Record<string, DeployTemplate[]> = {}
    for (const t of filtered) {
      const key = t.category || "starter"
      ;(g[key] ||= []).push(t)
    }
    return g
  }, [filtered])

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Agent templates · Sentrel" />
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(40% 50% at 20% 30%, var(--cyan-glow) 0%, transparent 60%), radial-gradient(40% 50% at 80% 60%, var(--indigo-glow) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
          <Overline accent dot>
            {templates.length} templates
          </Overline>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.025em] text-foreground md:text-6xl">
            Deploy a{" "}
            <span className="serif-italic text-[var(--color-indigo)]">ready-made</span> agent.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-muted-foreground md:text-[17px]">
            Browse community and system templates — each one a fully-configured role.
            See what it does, then hit Deploy to make it yours in a couple of clicks.
          </p>

          <div className="relative mt-8 max-w-md">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by role, name, or what it does…"
              className="pl-8"
            />
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="mx-auto w-full max-w-6xl px-6 py-12 md:py-16">
        {filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-muted-foreground">
            {templates.length === 0
              ? "No templates published yet — check back soon."
              : "No templates match your search."}
          </div>
        ) : (
          <div className="space-y-10">
            {featured.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-indigo)]">
                  <Star className="size-3.5 fill-current" />
                  Featured
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((t) => (
                    <TemplateDeployCard key={`featured-${t.slug}`} t={t} />
                  ))}
                </div>
              </section>
            )}
            {categories.map((cat) => {
              const items = grouped[cat]
              if (!items || items.length === 0) return null
              return (
                <section key={cat}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABEL[cat] ?? cat}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((t) => (
                      <TemplateDeployCard key={t.slug} t={t} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </section>

      <LandingFooter />
    </div>
  )
}
