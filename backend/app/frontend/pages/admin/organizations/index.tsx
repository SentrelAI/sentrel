import { router } from "@inertiajs/react"
import { useEffect, useState } from "react"
import AdminLayout from "@/layouts/admin-layout"
import BulkActionBar from "@/components/admin/bulk-action-bar"
import PaginationFooter, { PagyMeta } from "@/components/admin/pagination-footer"

interface Org {
  id: number
  name: string
  slug: string
  company_summary: string | null
  onboarding_completed_at: string | null
  created_at: string
  users_count: number
  agents_count: number
}

interface Props { organizations: Org[]; pagy: PagyMeta; q: string }

export default function AdminOrganizationsIndex({ organizations, pagy, q: initialQ }: Props) {
  const [selected, setSelected] = useState<number[]>([])
  const [search, setSearch] = useState(initialQ || "")

  useEffect(() => {
    if (search === (initialQ || "")) return
    const t = setTimeout(() => {
      const params: Record<string, string> = {}
      if (search) params.q = search
      router.get("/admin/organizations", params, { preserveScroll: true, preserveState: true, replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [search, initialQ])

  function destroy(o: Org) {
    if (!confirm(`Delete org "${o.slug}"? This is destructive (cascades agents, users, etc).`)) return
    router.delete(`/admin/organizations/${o.id}`, { preserveScroll: true })
  }
  function toggleSelect(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function toggleAll() {
    setSelected(selected.length === organizations.length ? [] : organizations.map((o) => o.id))
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Organizations" }]}>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Organizations ({pagy.count})</h1>
          <input
            placeholder="Search name / slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2 w-8">
                  <input type="checkbox" checked={selected.length > 0 && selected.length === organizations.length} onChange={toggleAll} />
                </th>
                <th className="p-2">Name</th>
                <th className="p-2">Slug</th>
                <th className="p-2">Onboarded</th>
                <th className="p-2">Users</th>
                <th className="p-2">Agents</th>
                <th className="p-2">Created</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2">
                    <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSelect(o.id)} />
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{o.name}</div>
                    {o.company_summary && <div className="text-xs text-muted-foreground truncate max-w-md">{o.company_summary}</div>}
                  </td>
                  <td className="p-2 font-mono text-xs">{o.slug}</td>
                  <td className="p-2 text-xs">{o.onboarding_completed_at ? "yes" : "no"}</td>
                  <td className="p-2 text-xs">{o.users_count}</td>
                  <td className="p-2 text-xs">{o.agents_count}</td>
                  <td className="p-2 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => destroy(o)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter pagy={pagy} basePath="/admin/organizations" query={{ q: search || undefined }} />
        </div>
        <BulkActionBar
          selectedIds={selected}
          onClear={() => setSelected([])}
          deletePath="/admin/organizations/bulk_destroy"
          noun="organization"
        />
      </div>
    </AdminLayout>
  )
}
