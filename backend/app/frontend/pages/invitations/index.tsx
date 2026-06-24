import { Head, router } from "@inertiajs/react"
import { useState } from "react"
import { toast } from "sonner"
import { Mail, Trash2, Users, Plus, Send } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { dashboardPath } from "@/routes"

interface Invitation {
  id: number
  email: string
  role: string
  status: "pending" | "accepted" | "expired"
  accepted_at: string | null
  expires_at: string
  invited_by: string | null
  created_at: string
}

interface Member {
  id: number
  email: string
  role: string
  created_at: string
}

interface Props {
  invitations: Invitation[]
  members: Member[]
  current_role: string
}

const ROLE_OPTIONS = [
  { value: "admin",  label: "Admin",  hint: "Can invite others + manage agents + billing" },
  { value: "member", label: "Member", hint: "Can create + use agents" },
  { value: "viewer", label: "Viewer", hint: "Read-only access to agents + chats" },
]

const STATUS_COLORS: Record<string, string> = {
  pending:  "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  accepted: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  expired:  "border-muted-foreground/20 bg-muted text-muted-foreground",
}

export default function InvitationsIndex({ invitations, members, current_role }: Props) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("member")
  const [sending, setSending] = useState(false)
  const [resendingId, setResendingId] = useState<number | null>(null)
  const canManage = current_role === "owner" || current_role === "admin"

  async function invite() {
    if (!email.trim()) return
    setSending(true)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch("/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ email, role }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Invitation sent to ${email}`)
        setEmail("")
        router.reload()
      } else {
        toast.error((data.errors || ["Invite failed"]).join(", "))
      }
    } finally {
      setSending(false)
    }
  }

  async function resend(inv: Invitation) {
    setResendingId(inv.id)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch(`/invitations/${inv.id}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Invitation re-sent to ${inv.email}`)
        router.reload()
      } else {
        toast.error((data.errors || ["Resend failed"]).join(", "))
      }
    } finally {
      setResendingId(null)
    }
  }

  async function revoke(id: number) {
    if (!confirm("Revoke this invitation?")) return
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    await fetch(`/invitations/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrf },
    })
    router.reload()
  }

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: dashboardPath() }, { label: "Team" }]}>
      <Head title="Team" />
      <PageHeader
        eyebrow="Organization"
        title="Team"
        description="Invite teammates and manage roles."
      />

      {canManage && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Plus className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Invite a teammate</h3>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <Label htmlFor="invite-email" className="text-xs">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div className="w-40">
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Pick a role">
                    {ROLE_OPTIONS.find((r) => r.value === role)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} textValue={r.label}>
                      <div className="flex flex-col gap-0.5 max-w-[18rem]">
                        <span className="font-medium">{r.label}</span>
                        <span className="text-xs text-muted-foreground whitespace-normal leading-snug">{r.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={invite} disabled={!email || sending} className="h-9">
              {sending ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Users className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Members ({members.length})</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">Email</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{m.email}</td>
                <td className="px-4 py-2 capitalize">{m.role}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 && (
        <div className="mt-6 rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Mail className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Invitations ({invitations.length})</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Invited by</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-xs">{inv.email}</td>
                  <td className="px-4 py-2 capitalize">{inv.role}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATUS_COLORS[inv.status]}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{inv.invited_by ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {inv.status !== "accepted" && canManage && (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => resend(inv)}
                          disabled={resendingId === inv.id}
                          className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-50"
                          title={inv.status === "expired" ? "Renew & resend invitation" : "Resend invitation"}
                        >
                          <Send className="size-3.5" />
                        </button>
                        <button
                          onClick={() => revoke(inv.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-red-500"
                          title="Revoke invitation"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  )
}
