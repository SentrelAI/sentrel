import { router } from "@inertiajs/react"
import { useState } from "react"
import AdminLayout from "@/layouts/admin-layout"

interface Agent {
  id: number
  name: string
  slug: string
  role: string
  status: string
  organization: { id: number; name: string; slug: string } | null
  ai_config: { provider: string; model_id: string } | null
  created_at: string
  updated_at: string
  channels: number
  skills: number
}

interface Props { agents: Agent[] }

export default function AdminAgentsIndex({ agents }: Props) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const filtered = agents.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false
    if (search && !`${a.name} ${a.slug} ${a.role} ${a.organization?.name || ""}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const statuses = Array.from(new Set(agents.map((a) => a.status))).sort()

  function destroy(a: Agent) {
    if (!confirm(`Delete agent ${a.name}? This removes their Fly machine + history.`)) return
    router.delete(`/admin/agents/${a.id}`, { preserveScroll: true })
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Agents" }]}>
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Agents ({agents.length})</h1>
          <input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border bg-background px-3 py-1.5 text-sm"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border bg-background px-2 py-1.5 text-sm">
            <option value="all">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Agent</th>
                <th className="p-2">Org</th>
                <th className="p-2">Role</th>
                <th className="p-2">Status</th>
                <th className="p-2">Model</th>
                <th className="p-2">Channels</th>
                <th className="p-2">Skills</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{a.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{a.slug}</div>
                  </td>
                  <td className="p-2 text-xs">{a.organization?.name || "—"}</td>
                  <td className="p-2 text-xs">{a.role}</td>
                  <td className="p-2"><StatusPill s={a.status} /></td>
                  <td className="p-2 font-mono text-xs">{a.ai_config?.model_id || "—"}</td>
                  <td className="p-2 text-xs">{a.channels}</td>
                  <td className="p-2 text-xs">{a.skills}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => destroy(a)} className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}

function StatusPill({ s }: { s: string }) {
  const color =
    s === "active" || s === "ready" ? "bg-green-100 text-green-700" :
    s === "provisioning" || s === "deploying" ? "bg-blue-100 text-blue-700" :
    s === "stopped" || s === "deleted" ? "bg-gray-200 text-gray-700" :
    s === "error" || s === "failed" ? "bg-red-100 text-red-700" :
    "bg-yellow-100 text-yellow-800"
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${color}`}>{s}</span>
}
