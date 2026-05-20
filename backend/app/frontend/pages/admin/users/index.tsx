import { router } from "@inertiajs/react"
import AppLayout from "@/layouts/app-layout"
import AdminNav from "@/components/admin/admin-nav"

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

interface Props { users: User[]; roles: string[] }

export default function AdminUsersIndex({ users, roles }: Props) {
  function changeRole(u: User, role: string) {
    router.put(`/admin/users/${u.id}`, { role }, { preserveScroll: true })
  }
  function togglePlatformAdmin(u: User) {
    router.put(`/admin/users/${u.id}`, { platform_admin: !u.platform_admin }, { preserveScroll: true })
  }
  return (
    <AppLayout crumbs={[{ label: "Admin" }, { label: "Users" }]}>
      <AdminNav />
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Users ({users.length})</h1>
        <p className="text-xs text-muted-foreground">
          <b>Role</b> is the user's role within their own organization. <b>Platform admin</b> grants cross-tenant /admin access — ScribeMD operators only.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Organization</th>
                <th className="p-2">Org Role</th>
                <th className="p-2">Platform Admin</th>
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t ${u.platform_admin ? "bg-purple-50/30 dark:bg-purple-950/10" : ""}`}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
