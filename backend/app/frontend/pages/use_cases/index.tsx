import { Head, Link } from "@inertiajs/react"
import { useMemo, useState } from "react"
import { Search, Plus, ArrowRight } from "lucide-react"

import { Overline } from "@/components/brand"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { LandingNav } from "@/components/landing/landing-nav"
import { LandingFooter } from "@/components/landing/landing-footer"

interface Role {
  name: string
  role: string
  outcome: string
  skills: string[]
  integrations: string[]
  template_slug?: string // set when a deployable template matches this role
}

interface Category {
  name: string
  blurb: string
  tone: "indigo" | "cyan"
  roles: Role[]
}

interface Props {
  categories: Category[]
}

export default function UseCasesIndex({ categories }: Props) {
  const [query, setQuery] = useState("")
  const [activeTone, setActiveTone] = useState<string | null>(null)

  const totalRoles = useMemo(
    () => categories.reduce((n, c) => n + c.roles.length, 0),
    [categories],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q && !activeTone) return categories
    return categories
      .filter((c) => !activeTone || c.tone === activeTone)
      .map((c) => ({
        ...c,
        roles: c.roles.filter((r) => {
          if (!q) return true
          const hay = [r.name, r.role, r.outcome, ...r.skills, ...r.integrations]
            .join(" ")
            .toLowerCase()
          return hay.includes(q)
        }),
      }))
      .filter((c) => c.roles.length > 0)
  }, [categories, query, activeTone])

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Use cases · Sentrel" />
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
            {totalRoles} roles · {categories.length} teams
          </Overline>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.025em] text-foreground md:text-6xl">
            Pick your{" "}
            <span className="serif-italic text-[var(--color-indigo)]">first hire</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-muted-foreground md:text-[17px]">
            Every role here ships pre-wired with the skills + integrations it needs.
            Click a card to spin one up, plug in your tools, and have them at work in
            under 5 minutes. No "what should I prompt it" moment.
          </p>

          {/* Search + filter */}
          <div className="mt-10 flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by name, role, skill, or integration…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            <div className="flex gap-2">
              <ToneFilter active={activeTone === null} onClick={() => setActiveTone(null)}>
                All teams
              </ToneFilter>
              <ToneFilter active={activeTone === "indigo"} onClick={() => setActiveTone("indigo")}>
                Customer-facing
              </ToneFilter>
              <ToneFilter active={activeTone === "cyan"} onClick={() => setActiveTone("cyan")}>
                Internal ops
              </ToneFilter>
            </div>
          </div>
        </div>
      </section>

      {/* Category sections */}
      <main className="mx-auto w-full max-w-6xl px-6 py-16 space-y-20">
        {filtered.map((cat) => (
          <section key={cat.name} id={cat.name.toLowerCase().replace(/\s+/g, "-")}>
            <div className="mb-8 flex items-baseline justify-between gap-4 flex-wrap">
              <div>
                <Overline accent={cat.tone === "cyan"}>
                  {cat.name} · {cat.roles.length} role{cat.roles.length === 1 ? "" : "s"}
                </Overline>
                <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em] text-foreground md:text-3xl">
                  {cat.blurb}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cat.roles.map((r) => (
                <RoleCard key={`${cat.name}-${r.name}`} role={r} tone={cat.tone} />
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No roles match "{query}". Try a different keyword, or{" "}
              <Link href="/agents/new" className="text-[var(--color-indigo)] underline-offset-4 hover:underline">
                build a custom one
              </Link>
              .
            </p>
          </div>
        )}
      </main>

      {/* Final CTA */}
      <section className="border-t bg-muted/20 py-16">
        <div className="mx-auto w-full max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] text-foreground md:text-4xl">
            Don't see your role?
          </h2>
          <p className="mt-4 text-[15px] text-muted-foreground">
            Start from scratch. Describe what you want this teammate to do, pick the
            tools, set the policies. 90 seconds to first message.
          </p>
          <Button asChild size="lg" className="mt-8 gap-2 h-12 px-6">
            <Link href="/agents/new">
              Build a custom agent
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}

function ToneFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--color-indigo)] bg-[var(--indigo-surface)] text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-[var(--border-strong)] hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function RoleCard({ role, tone }: { role: Role; tone: "indigo" | "cyan" }) {
  // Matched roles deploy the REAL template (browse → deploy); unmatched fall
  // back to the generic new-agent flow seeded with the role name.
  const newAgentHref = role.template_slug
    ? `/agents/new?template=${encodeURIComponent(role.template_slug)}`
    : `/agents/new?template=${encodeURIComponent(role.name.toLowerCase())}&role=${encodeURIComponent(role.role)}`

  return (
    <Link
      href={newAgentHref}
      className="group flex flex-col rounded-lg border bg-card p-5 transition-all hover:border-[var(--border-strong)] hover:shadow-sm"
    >
      <div className="mb-3 flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-md border font-display text-sm font-semibold"
          style={{
            borderColor: tone === "cyan" ? "var(--cyan-border)" : "var(--indigo-border)",
            background: tone === "cyan" ? "var(--cyan-surface)" : "var(--indigo-surface)",
            color: tone === "cyan" ? "var(--cyan)" : "var(--color-indigo)",
          }}
        >
          {role.name.charAt(0)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm font-semibold leading-tight">{role.name}</div>
          <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{role.role}</div>
        </div>
        <Plus className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <p className="text-[12.5px] text-muted-foreground leading-relaxed mb-4 flex-1">{role.outcome}</p>

      <div className="mt-auto space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {role.skills.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {s}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {role.integrations.slice(0, 3).map((i) => (
            <span
              key={i}
              className="rounded-sm border border-[var(--cyan-border)] bg-[var(--cyan-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--cyan)]"
            >
              {i}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
