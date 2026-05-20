import { router } from "@inertiajs/react"
import { useState } from "react"
import AppLayout from "@/layouts/app-layout"
import AdminNav from "@/components/admin/admin-nav"

interface Skill {
  id: number
  slug: string
  name: string
  category: string
  description: string
  icon: string
  published: boolean
  source: string
  source_url: string | null
  requires_connections: string[]
  skill_md: string
  files: Array<{ path: string; file_type: string }>
  updated_at: string
  quality: { pass: boolean; score: number; warnings: Array<{ rule: string; message: string }> }
}

interface Props {
  skills: Skill[]
  categories: string[]
}

export default function AdminSkillsIndex({ skills, categories }: Props) {
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  const filtered = skills.filter((s) => {
    if (filter !== "all" && s.category !== filter) return false
    if (search && !`${s.name} ${s.slug} ${s.description}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function togglePublished(s: Skill) {
    router.put(`/admin/skills/${s.id}`, { published: !s.published }, { preserveScroll: true })
  }
  function destroy(s: Skill) {
    if (!confirm(`Delete skill "${s.slug}"?`)) return
    router.delete(`/admin/skills/${s.id}`, { preserveScroll: true })
  }
  function resync(s: Skill) {
    if (!s.source_url) {
      alert("No source_url to resync from")
      return
    }
    router.post(`/admin/skills/${s.id}/resync`, {}, { preserveScroll: true })
  }

  return (
    <AppLayout crumbs={[{ label: "Admin" }, { label: "Skills" }]}>
      <AdminNav />
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Skills ({skills.length})</h1>
          <input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border bg-background px-3 py-1.5 text-sm"
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded border bg-background px-2 py-1.5 text-sm">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Slug / Name</th>
                <th className="p-2">Category</th>
                <th className="p-2">Source</th>
                <th className="p-2">Files</th>
                <th className="p-2">Integrations</th>
                <th className="p-2">Quality</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <>
                  <tr key={s.id} className="border-t">
                    <td className="p-2">
                      <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="text-left hover:underline">
                        <div className="font-medium">{s.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{s.slug}</div>
                      </button>
                    </td>
                    <td className="p-2 text-xs">{s.category}</td>
                    <td className="p-2 text-xs">
                      {s.source}
                      {s.source_url && (
                        <a href={s.source_url} target="_blank" rel="noopener" className="ml-1 text-blue-600 hover:underline">↗</a>
                      )}
                    </td>
                    <td className="p-2 text-xs">{s.files.length}</td>
                    <td className="p-2 text-xs">{s.requires_connections.join(", ") || "—"}</td>
                    <td className="p-2">
                      <span className={s.quality.pass ? "text-green-600" : "text-red-600"}>{s.quality.score}</span>
                    </td>
                    <td className="p-2">
                      {s.published ? (
                        <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">published</span>
                      ) : (
                        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-800">pending</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <button onClick={() => togglePublished(s)} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                        {s.published ? "Unpublish" : "Publish"}
                      </button>
                      {s.source_url && (
                        <button onClick={() => resync(s)} className="ml-1 rounded border px-2 py-1 text-xs hover:bg-muted">Resync</button>
                      )}
                      <button onClick={() => destroy(s)} className="ml-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr className="bg-muted/40">
                      <td colSpan={8} className="p-4">
                        <div className="mb-2 text-[10px] font-medium uppercase text-muted-foreground">SKILL.md</div>
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">{s.skill_md}</pre>
                        {s.files.length > 1 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            + {s.files.length - 1} supporting file{s.files.length > 2 ? "s" : ""}: {s.files.filter(f => f.path !== "SKILL.md").map(f => f.path).join(", ")}
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
    </AppLayout>
  )
}
