import { Link, router } from "@inertiajs/react"
import { useEffect, useState } from "react"
import { Sparkles, Star } from "lucide-react"
import AdminLayout from "@/layouts/admin-layout"
import BulkActionBar from "@/components/admin/bulk-action-bar"
import PaginationFooter, { PagyMeta } from "@/components/admin/pagination-footer"

interface Template {
  id: number
  slug: string
  name: string
  role: string
  category: string
  description: string
  icon: string | null
  published: boolean
  featured: boolean
  featured_position: number | null
  install_count: number
  system_template: boolean
  suggested_model: string
  suggested_provider: string
  suggested_skill_slugs: string[]
  suggested_integrations: string[]
  identity_md: string
  personality_md: string
  instructions_md: string
  email_signature_md: string | null
  updated_at: string
  quality: { pass: boolean; score: number; warnings: Array<{ rule: string; message: string }> }
}

interface Props {
  templates: Template[]
  categories: string[]
  pagy: PagyMeta
  q: string
  category: string
}

export default function AdminTemplatesIndex({ templates, categories, pagy, q: initialQ, category: initialCategory }: Props) {
  const [filter, setFilter] = useState<string>(initialCategory || "all")
  const [search, setSearch] = useState(initialQ || "")
  const [showOnly, setShowOnly] = useState<"all" | "pending" | "system" | "community">("all")
  const [expanded, setExpanded] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const toggleSelect = (id: number) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  // Debounce server-side search/category — push to the URL so pagination
  // resets to page 1 with the new filter applied across the full dataset.
  useEffect(() => {
    if (search === (initialQ || "") && filter === (initialCategory || "all")) return
    const t = setTimeout(() => {
      const params: Record<string, string> = {}
      if (search) params.q = search
      if (filter && filter !== "all") params.category = filter
      router.get("/admin/templates", params, { preserveScroll: true, preserveState: true, replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [search, filter, initialQ, initialCategory])

  // showOnly stays client-side: it filters within the current page.
  const filtered = templates.filter((t) => {
    if (showOnly === "pending" && t.published) return false
    if (showOnly === "system" && !t.system_template) return false
    if (showOnly === "community" && t.system_template) return false
    return true
  })

  function togglePublished(t: Template) {
    router.put(`/admin/templates/${t.id}`, { published: !t.published }, { preserveScroll: true })
  }

  function toggleFeatured(t: Template) {
    if (!t.featured && !t.system_template) {
      const ok = confirm(
        `"${t.slug}" is a community/org-owned template. Featuring shows it publicly, but it can only be deployed by its owning org unless it's promoted to a system template first. Feature anyway?`,
      )
      if (!ok) return
    }
    router.put(`/admin/templates/${t.id}`, { featured: !t.featured }, { preserveScroll: true })
  }

  function destroy(t: Template) {
    if (!confirm(`Delete template "${t.slug}"? This can't be undone.`)) return
    router.delete(`/admin/templates/${t.id}`, { preserveScroll: true })
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Templates" }]}>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Templates ({pagy.count})</h1>
          <Link
            href="/admin/templates/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
          >
            <Sparkles className="size-3.5" />
            Create with AI
          </Link>
          <input
            placeholder="Search slug / name / role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border bg-background px-3 py-1.5 text-sm"
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border bg-background px-2 py-1.5 text-sm">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={showOnly} onChange={(e) => setShowOnly(e.target.value as typeof showOnly)} className="rounded border bg-background px-2 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="pending">Pending (unpublished)</option>
            <option value="system">System only</option>
            <option value="community">Community only</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.length > 0 && selected.length === filtered.length}
                    onChange={() => setSelected(selected.length === filtered.length ? [] : filtered.map((t) => t.id))}
                  />
                </th>
                <th className="p-2">Slug / Name</th>
                <th className="p-2">Role</th>
                <th className="p-2">Category</th>
                <th className="p-2">Model</th>
                <th className="p-2">Skills</th>
                <th className="p-2">Quality</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <>
                  <tr key={t.id} className="border-t">
                    <td className="p-2">
                      <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)} />
                    </td>
                    <td className="p-2">
                      <button onClick={() => setExpanded(expanded === t.id ? null : t.id)} className="text-left hover:underline">
                        <div className="font-medium">{t.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{t.slug}</div>
                      </button>
                    </td>
                    <td className="p-2">{t.role}</td>
                    <td className="p-2 text-xs">{t.category}</td>
                    <td className="p-2 font-mono text-xs">{t.suggested_model}</td>
                    <td className="p-2 text-xs">{t.suggested_skill_slugs.length}</td>
                    <td className="p-2">
                      <span className={t.quality.pass ? "text-green-600" : "text-red-600"}>{t.quality.score}</span>
                      {!t.quality.pass && <span className="ml-1 text-[10px] text-red-600">({t.quality.warnings.length} warnings)</span>}
                    </td>
                    <td className="p-2">
                      {t.published ? (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">published</span>
                      ) : (
                        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800">pending</span>
                      )}
                      {!t.system_template && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">community</span>}
                      {t.featured && <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">featured</span>}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => toggleFeatured(t)}
                        title={t.featured ? "Remove from Featured" : "Add to Featured"}
                        className={`rounded border px-2 py-1 text-xs hover:bg-muted ${t.featured ? "border-indigo-300 text-indigo-600" : ""}`}
                      >
                        <Star className={`size-3.5 ${t.featured ? "fill-current" : ""}`} />
                      </button>
                      <button onClick={() => togglePublished(t)} className="ml-1 rounded border px-2 py-1 text-xs hover:bg-muted">
                        {t.published ? "Unpublish" : "Publish"}
                      </button>
                      <button onClick={() => destroy(t)} className="ml-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr className="bg-muted/40">
                      <td colSpan={9} className="p-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Identity">{t.identity_md}</Field>
                          <Field label="Personality">{t.personality_md}</Field>
                          <Field label="Instructions" full>{t.instructions_md}</Field>
                          <Field label="Email signature">{t.email_signature_md || "(none)"}</Field>
                          <Field label="Suggested integrations">{t.suggested_integrations.join(", ") || "(none)"}</Field>
                        </div>
                        {!t.quality.pass && (
                          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                            <div className="font-semibold">Quality warnings</div>
                            <ul className="ml-4 list-disc">
                              {t.quality.warnings.map((w, i) => (
                                <li key={i}>[{w.rule}] {w.message}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <PaginationFooter
            pagy={pagy}
            basePath="/admin/templates"
            query={{ q: search || undefined, category: filter !== "all" ? filter : undefined }}
          />
        </div>
        <BulkActionBar
          selectedIds={selected}
          onClear={() => setSelected([])}
          deletePath="/admin/templates/bulk_destroy"
          noun="template"
          totalCount={pagy.count}
          filterParams={{ q: search || undefined, category: filter !== "all" ? filter : undefined }}
        />
      </div>
    </AdminLayout>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <pre className="whitespace-pre-wrap rounded border bg-background p-2 text-xs">{children}</pre>
    </div>
  )
}
