import { router } from "@inertiajs/react"
import { useEffect, useState } from "react"
import { LogIn, Trash2 } from "lucide-react"
import AdminLayout from "@/layouts/admin-layout"
import BulkActionBar from "@/components/admin/bulk-action-bar"
import PaginationFooter, { PagyMeta } from "@/components/admin/pagination-footer"

interface User {
  id: number
  name: string
  email: string
  role: string
  platform_admin: boolean
  is_current: boolean
  organization: { id: number; name: string; slug: string } | null
  created_at: string
  current_sign_in_at: string | null
}

interface Props { users: User[]; roles: string[]; pagy: PagyMeta; q: string }

export default function AdminUsersIndex({ users, roles, pagy, q: initialQ }: Props) {
  const [selected, setSelected] = useState<number[]>([])
  const [search, setSearch] = useState(initialQ || "")

  useEffect(() => {
    if (search === (initialQ || "")) return
    const t = setTimeout(() => {
      const params: Record<string, string> = {}
      if (search) params.q = search
      router.get("/admin/users", params, { preserveScroll: true, preserveState: true, replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [search, initialQ])

  function changeRole(u: User, role: string) {
    router.put(`/admin/users/${u.id}`, { role }, { preserveScroll: true })
  }
  function togglePlatformAdmin(u: User) {
    router.put(`/admin/users/${u.id}`, { platform_admin: !u.platform_admin }, { preserveScroll: true })
  }
  function destroyUser(u: User) {
    if (!confirm(`Delete ${u.email}?`)) return
    router.delete(`/admin/users/${u.id}`, { preserveScroll: true })
  }
  function masqueradeAs(u: User) {
    if (!confirm(`Sign in as ${u.email}? Every page will show a banner until you stop. The action is audit-logged.`)) return
    router.post(`/admin/users/${u.id}/masquerade`)
  }
  function toggleSelect(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function toggleAll() {
    const selectable = users.filter((u) => !u.is_current).map((u) => u.id)
    setSelected(selected.length === selectable.length ? [] : selectable)
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Users" }]}>
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Users ({pagy.count})</h1>
          <input
            placeholder="Search email / name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          <b>Role</b> is the user's role within their own organization. <b>Platform admin</b> grants cross-tenant /admin access — ScribeMD operators only.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.length > 0 && selected.length === users.filter((u) => !u.is_current).length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Organization</th>
                <th className="p-2">Org Role</th>
                <th className="p-2">Platform Admin</th>
                <th className="p-2">Created</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t ${u.platform_admin ? "bg-purple-50/30 dark:bg-purple-950/10" : ""}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(u.id)}
                      disabled={u.is_current}
                      onChange={() => toggleSelect(u.id)}
                    />
                  </td>
                  <td className="p-2">
                    {u.name}
                    {u.is_current && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">you</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">{u.email}</td>
                  <td className="p-2 text-xs">{u.organization?.name || "—"}</td>
                  <td className="p-2">
                    <select
                      value={u.role}
                      disabled={u.is_current}
                      onChange={(e) => changeRole(u, e.target.value)}
                      className="rounded border bg-background px-2 py-1 text-xs"
                    >
                      {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={u.platform_admin}
                        disabled={u.is_current && u.platform_admin}
                        onChange={() => togglePlatformAdmin(u)}
                      />
                      {u.platform_admin && <span className="rounded bg-purple-200 dark:bg-purple-800 px-1.5 py-0.5 text-[10px] uppercase font-medium">platform</span>}
                    </label>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="p-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => masqueradeAs(u)}
                        disabled={u.is_current || u.platform_admin}
                        className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          u.is_current
                            ? "Can't masquerade as yourself"
                            : u.platform_admin
                            ? "Can't masquerade as another platform admin"
                            : "Sign in as this user"
                        }
                      >
                        <LogIn className="size-3" />
                      </button>
                      <button
                        onClick={() => destroyUser(u)}
                        disabled={u.is_current}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        title={u.is_current ? "Can't delete yourself" : "Delete user"}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter pagy={pagy} basePath="/admin/users" query={{ q: search || undefined }} />
        </div>
        <BulkActionBar
          selectedIds={selected}
          onClear={() => setSelected([])}
          deletePath="/admin/users/bulk_destroy"
          noun="user"
          totalCount={pagy.count}
          filterParams={{ q: search || undefined }}
        />
      </div>
    </AdminLayout>
  )
}
