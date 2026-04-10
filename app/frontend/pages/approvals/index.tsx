import { Head, router } from "@inertiajs/react"
import { ShieldCheck, Check, X, Mail, ChevronDown, ChevronUp, Clock } from "lucide-react"
import { useState } from "react"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Approval {
  id: number
  tool_name: string
  tool_input: Record<string, unknown>
  context: string | null
  status: string
  reviewed_at: string | null
  created_at: string
  agent: { id: number; name: string; slug: string }
  reviewed_by: { id: number; name: string } | null
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString()
}

export default function ApprovalsIndex({ approvals }: { approvals: Approval[] }) {
  const pending = approvals.filter((a) => a.status === "pending")
  const reviewed = approvals.filter((a) => a.status !== "pending")

  function handleApproval(id: number, status: "approved" | "rejected") {
    router.patch(`/pending_approvals/${id}`, { status }, { preserveScroll: true })
  }

  return (
    <AppLayout>
      <Head title="Approvals" />

      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Review actions your agents want to take</p>
      </div>

      {approvals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-lg">
          <ShieldCheck className="size-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium mb-1">All clear</p>
          <p className="text-xs text-muted-foreground">No pending approvals. Your agents are running smoothly.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Pending ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((approval) => (
              <PendingCard key={approval.id} approval={approval} onAction={handleApproval} />
            ))}
          </div>
        </div>
      )}

      {reviewed.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">History</h2>
          <div className="space-y-1.5">
            {reviewed.map((approval) => (
              <HistoryRow key={approval.id} approval={approval} />
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function PendingCard({ approval, onAction }: { approval: Approval; onAction: (id: number, status: "approved" | "rejected") => void }) {
  const isEmail = approval.tool_name === "send_email"
  const emailData = isEmail ? approval.tool_input : null

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-muted">
            {isEmail ? <Mail className="size-3 text-muted-foreground" /> : <ShieldCheck className="size-3 text-muted-foreground" />}
          </div>
          <span className="text-sm font-medium">{approval.agent.name}</span>
          <span className="text-xs text-muted-foreground">wants to</span>
          <Badge variant="secondary" className="font-mono text-[10px]">{approval.tool_name.replace("_", " ")}</Badge>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="size-2.5" />
            {timeAgo(approval.created_at)}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="h-7 text-xs px-3" onClick={() => onAction(approval.id, "approved")}>
            <Check className="size-3 mr-1" />
            Send
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => onAction(approval.id, "rejected")}>
            <X className="size-3" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isEmail && emailData && (
        <div className="px-4 py-3 space-y-2.5">
          <div className="space-y-1 text-xs">
            <div className="flex gap-3">
              <span className="w-10 text-muted-foreground shrink-0">To</span>
              <span className="font-medium">{Array.isArray(emailData.to) ? (emailData.to as string[]).join(", ") : emailData.to as string}</span>
            </div>
            {Array.isArray(emailData.cc) && (emailData.cc as string[]).length > 0 && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">CC</span>
                <span>{(emailData.cc as string[]).join(", ")}</span>
              </div>
            )}
            {Array.isArray(emailData.bcc) && (emailData.bcc as string[]).length > 0 && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">BCC</span>
                <span>{(emailData.bcc as string[]).join(", ")}</span>
              </div>
            )}
            {emailData.subject && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">Subj</span>
                <span className="font-medium">{emailData.subject as string}</span>
              </div>
            )}
          </div>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto border-t border-border pt-2.5">
            {String(emailData.body_text || emailData.body_html || "")}
          </div>
        </div>
      )}

      {!isEmail && (
        <div className="px-4 py-3">
          {approval.context && <p className="text-sm text-muted-foreground mb-2">{approval.context}</p>}
          <pre className="text-xs text-muted-foreground bg-muted p-2.5 rounded overflow-auto max-h-24 font-mono">
            {JSON.stringify(approval.tool_input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function HistoryRow({ approval }: { approval: Approval }) {
  const [expanded, setExpanded] = useState(false)
  const isEmail = approval.tool_name === "send_email"
  const emailData = isEmail ? approval.tool_input : null
  const isApproved = approval.status === "approved"

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{approval.agent.name}</span>
          <Badge variant="secondary" className="font-mono text-[10px]">{approval.tool_name.replace("_", " ")}</Badge>
          {isEmail && emailData && (
            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
              to {Array.isArray(emailData.to) ? (emailData.to as string[]).join(", ") : emailData.to as string}
              {emailData.subject ? ` — ${emailData.subject}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {approval.reviewed_by && (
            <span className="text-[10px] text-muted-foreground">by {approval.reviewed_by.name}</span>
          )}
          <span className="text-[10px] text-muted-foreground">{timeAgo(approval.reviewed_at || approval.created_at)}</span>
          <Badge
            variant="secondary"
            className={`text-[10px] ${isApproved ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/10" : "text-red-400 border-red-400/20 bg-red-400/10"}`}
          >
            {isApproved ? "Sent" : "Rejected"}
          </Badge>
          {expanded ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
        </div>
      </button>

      {expanded && isEmail && emailData && (
        <div className="px-4 py-3 border-t border-border space-y-2">
          <div className="space-y-1 text-xs">
            <div className="flex gap-3">
              <span className="w-10 text-muted-foreground shrink-0">From</span>
              <span>{emailData.from_name as string} &lt;{emailData.from_address as string}&gt;</span>
            </div>
            <div className="flex gap-3">
              <span className="w-10 text-muted-foreground shrink-0">To</span>
              <span>{Array.isArray(emailData.to) ? (emailData.to as string[]).join(", ") : emailData.to as string}</span>
            </div>
            {Array.isArray(emailData.cc) && (emailData.cc as string[]).length > 0 && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">CC</span>
                <span>{(emailData.cc as string[]).join(", ")}</span>
              </div>
            )}
            {Array.isArray(emailData.bcc) && (emailData.bcc as string[]).length > 0 && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">BCC</span>
                <span>{(emailData.bcc as string[]).join(", ")}</span>
              </div>
            )}
            {emailData.subject && (
              <div className="flex gap-3">
                <span className="w-10 text-muted-foreground shrink-0">Subj</span>
                <span className="font-medium">{emailData.subject as string}</span>
              </div>
            )}
          </div>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto border-t border-border pt-2">
            {String(emailData.body_text || emailData.body_html || "")}
          </div>
        </div>
      )}

      {expanded && !isEmail && (
        <div className="px-4 py-3 border-t border-border">
          <pre className="text-xs text-muted-foreground bg-muted p-2.5 rounded overflow-auto max-h-24 font-mono">
            {JSON.stringify(approval.tool_input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
