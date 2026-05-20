import { router } from "@inertiajs/react"
import AppLayout from "@/layouts/app-layout"
import AdminNav from "@/components/admin/admin-nav"

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

interface Props { organizations: Org[] }

export default function AdminOrganizationsIndex({ organizations }: Props) {
  function destroy(o: Org) {
    if (!confirm(`Delete org "${o.slug}"? This is destructive (cascades agents, users, etc).`)) return
    router.delete(`/admin/organizations/${o.id}`, { preserveScroll: true })
  }
  return (
    <AppLayout crumbs={[{ label: "Admin" }, { label: "Organizations" }]}>
      <AdminNav />
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Organizations ({organizations.length})</h1>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
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
        </div>
      </div>
    </AppLayout>
  )
}
