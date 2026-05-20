import { router } from "@inertiajs/react"
import { useState } from "react"
import AdminLayout from "@/layouts/admin-layout"

interface Template {
  id: number
  slug: string
  name: string
  role: string
  category: string
  description: string
  icon: string | null
  published: boolean
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
}

export default function AdminTemplatesIndex({ templates, categories }: Props) {
  const [filter, setFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [showOnly, setShowOnly] = useState<"all" | "pending" | "system" | "community">("all")
  const [expanded, setExpanded] = useState<number | null>(null)

  const filtered = templates.filter((t) => {
    if (filter !== "all" && t.category !== filter) return false
    if (showOnly === "pending" && t.published) return false
    if (showOnly === "system" && !t.system_template) return false
    if (showOnly === "community" && t.system_template) return false
    if (search && !`${t.name} ${t.slug} ${t.role}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function togglePublished(t: Template) {
    router.put(`/admin/templates/${t.id}`, { published: !t.published }, { preserveScroll: true })
  }

  function destroy(t: Template) {
    if (!confirm(`Delete template "${t.slug}"? This can't be undone.`)) return
    router.delete(`/admin/templates/${t.id}`, { preserveScroll: true })
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Templates" }]}>
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Templates ({templates.length})</h1>
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
                    </td>
                    <td className="p-2 text-right">
                      <button onClick={() => togglePublished(t)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                        {t.published ? "Unpublish" : "Publish"}
                      </button>
                      <button onClick={() => destroy(t)} className="ml-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr className="bg-muted/40">
                      <td colSpan={8} className="p-4">
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
        </div>
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
