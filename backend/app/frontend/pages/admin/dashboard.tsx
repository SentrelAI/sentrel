import AppLayout from "@/layouts/app-layout"
import AdminNav from "@/components/admin/admin-nav"
import { Link } from "@inertiajs/react"

interface Counts {
  templates: number
  templates_published: number
  skills: number
  skills_published: number
  agents: number
  users: number
  organizations: number
}

interface EnvSource {
  name: string
  required: boolean
  present: boolean
  last_four: string | null
  note: string
}

interface RecentTemplate {
  id: number
  slug: string
  name: string
  category: string
  published: boolean
  install_count: number
  quality_pass: boolean
  quality_score: number
  updated_at: string
}

interface RecentSkill {
  id: number
  slug: string
  name: string
  category: string
  published: boolean
  source: string
  quality_pass: boolean
  quality_score: number
  updated_at: string
}

interface Props {
  counts: Counts
  env_sources: EnvSource[]
  recent_templates: RecentTemplate[]
  recent_skills: RecentSkill[]
  last_run: Record<string, unknown>
}

export default function AdminDashboard({ counts, env_sources, recent_templates, recent_skills, last_run }: Props) {
  const tiles: Array<{ label: string; value: number; sub?: string }> = [
    { label: "Templates", value: counts.templates, sub: `${counts.templates_published} published` },
    { label: "Skills", value: counts.skills, sub: `${counts.skills_published} published` },
    { label: "Agents", value: counts.agents },
    { label: "Users", value: counts.users },
    { label: "Orgs", value: counts.organizations },
  ]

  return (
    <AppLayout crumbs={[{ label: "Admin" }, { label: "Dashboard" }]}>
      <AdminNav />
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground">{t.label}</div>
              <div className="mt-1 text-2xl font-semibold">{t.value}</div>
              {t.sub && <div className="mt-0.5 text-xs text-muted-foreground">{t.sub}</div>}
            </div>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Env sources</h2>
            <ul className="space-y-2">
              {env_sources.map((s) => (
                <li key={s.name} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={s.present ? "text-green-600" : "text-red-600"}>{s.present ? "●" : "○"}</span>
                      <span className="font-mono">{s.name}</span>
                      {s.required && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-orange-700">required</span>}
                    </div>
                    <div className="ml-5 text-xs text-muted-foreground">{s.note}</div>
                  </div>
                  {s.present && s.last_four && <span className="font-mono text-xs text-muted-foreground">…{s.last_four}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Last Forge run</h2>
            {Object.keys(last_run || {}).length === 0 ? (
              <div className="text-sm text-muted-foreground">No bootstrap has been run yet. <Link href="/admin/forge" className="underline">Run one →</Link></div>
            ) : (
              <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(last_run, null, 2)}</pre>
            )}
          </section>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <RecentList title="Recent templates" rows={recent_templates} hrefBase="/admin/templates" />
          <RecentList title="Recent skills" rows={recent_skills} hrefBase="/admin/skills" />
        </div>
      </div>
    </AppLayout>
  )
}

function RecentList({ title, rows, hrefBase }: { title: string; rows: Array<{ id: number; slug: string; name: string; category: string; published: boolean; quality_pass: boolean; quality_score: number }>; hrefBase: string }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link href={hrefBase} className="text-xs text-muted-foreground underline">View all</Link>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between border-b px-3 py-2 last:border-b-0 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.slug} · {r.category}</div>
            </div>
            <div className="flex items-center gap-2">
              {!r.published && <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800">pending</span>}
              <span className={`text-xs ${r.quality_pass ? "text-green-600" : "text-red-600"}`}>q={r.quality_score}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
