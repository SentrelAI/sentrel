import { Head, router } from "@inertiajs/react"
import { ShieldCheck, Check, X, Mail, ChevronDown, ChevronUp, Clock, Paperclip, Linkedin, Twitter, DollarSign, Share2, AlertTriangle, Mails, FileText, Pencil } from "lucide-react"
import { useState } from "react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ApprovalAttachment {
  signed_id: string
  filename: string
  content_type: string
  byte_size: number
  url: string
}

interface ApprovalOption { label: string; value: string }

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
  attachments?: ApprovalAttachment[]
  // Item 4 — generic action approvals carry a richer payload.
  summary?: string | null
  payload_type?: string | null
  options?: ApprovalOption[]
  risk_tier?: string | null
  decision?: string | null
  decision_text?: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function AttachmentChips({ attachments }: { attachments?: ApprovalAttachment[] }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-border mt-2">
      {attachments.map((att) => (
        <a
          key={att.signed_id}
          href={att.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={`${att.filename} (${formatBytes(att.byte_size)})`}
        >
          <Paperclip className="size-3" />
          <span className="max-w-[180px] truncate">{att.filename}</span>
          <span className="text-[10px] text-muted-foreground/60">{formatBytes(att.byte_size)}</span>
        </a>
      ))}
    </div>
  )
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

type ApprovalFilter = "all" | "pending" | "approved" | "rejected"

export default function ApprovalsIndex({ approvals }: { approvals: Approval[] }) {
  const [filter, setFilter] = useState<ApprovalFilter>("pending")
  const [query, setQuery] = useState("")

  const pendingCount = approvals.filter((a) => a.status === "pending").length
  const approvedCount = approvals.filter((a) => a.status === "approved").length
  const rejectedCount = approvals.filter((a) => a.status === "rejected").length

  const filtered = approvals.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (
      a.tool_name.toLowerCase().includes(q) ||
      a.agent.name.toLowerCase().includes(q) ||
      (a.context ?? "").toLowerCase().includes(q)
    )
  })

  const pending = filtered.filter((a) => a.status === "pending")
  const reviewed = filtered.filter((a) => a.status !== "pending")

  function handleApproval(id: number, status: "approved" | "rejected", decision?: string, decisionText?: string) {
    const payload: Record<string, string> = { status }
    if (decision) payload.decision = decision
    if (decisionText) payload.decision_text = decisionText
    router.patch(`/pending_approvals/${id}`, payload, { preserveScroll: true })
  }

  const TABS: { key: ApprovalFilter; label: string; count: number; tone?: string }[] = [
    { key: "all", label: "All", count: approvals.length },
    { key: "pending", label: "Pending", count: pendingCount, tone: "warning" },
    { key: "approved", label: "Approved", count: approvedCount, tone: "success" },
    { key: "rejected", label: "Rejected", count: rejectedCount, tone: "destructive" },
  ]

  return (
    <AppLayout
      crumbs={[
        { label: "Control plane", href: "/" },
        { label: "Approvals" },
      ]}
      topBarActions={
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tool, agent, context…"
            className="h-8 w-64 rounded-md border bg-card px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-[var(--color-indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-surface)]"
          />
        </div>
      }
    >
      <Head title="Approvals" />

      <PageHeader
        eyebrow="Control plane"
        title="Approvals"
        description="Review actions your agents want to take before they happen."
      />

      {/* Filter tabs */}
      <div className="mb-6 flex items-center gap-1 rounded-md border bg-card p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex items-center gap-2 rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors ${
              filter === tab.key
                ? "bg-[var(--indigo-surface)] text-[var(--color-indigo)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            <span
              className={`rounded-sm px-1.5 font-mono text-[10px] ${
                filter === tab.key
                  ? "bg-[var(--color-indigo)]/15"
                  : "bg-[var(--muted)]"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {approvals.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20">
          <ShieldCheck className="mb-3 size-8 text-[var(--color-success)]/60" />
          <p className="mb-1 font-display text-sm font-semibold text-foreground">All clear</p>
          <p className="text-xs text-muted-foreground">
            No pending approvals. Your agents are within policy.
          </p>
        </div>
      )}

      {approvals.length > 0 && filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="font-mono text-sm text-muted-foreground">No approvals match your filter.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-10">
          <Overline className="mb-3">
            <span className="size-1.5 rounded-full bg-[var(--color-warning)]" />
            Pending · {pending.length}
          </Overline>
          <div className="space-y-3">
            {pending.map((approval) => (
              <PendingCard key={approval.id} approval={approval} onAction={handleApproval} />
            ))}
          </div>
        </div>
      )}

      {reviewed.length > 0 && (
        <div>
          <Overline className="mb-3">History</Overline>
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

function PendingCard({ approval, onAction }: { approval: Approval; onAction: (id: number, status: "approved" | "rejected", decision?: string, decisionText?: string) => void }) {
  const isEmail = approval.tool_name === "send_email"
  const emailData = isEmail ? approval.tool_input : null
  const isAction = !!approval.payload_type
  const payload = (approval.tool_input || {}) as Record<string, unknown>
  const allowAmend = payload._allow_amendment === true
  const [amendOpen, setAmendOpen] = useState(false)
  const [amendText, setAmendText] = useState("")

  const meta = isAction ? PAYLOAD_TYPE_META[approval.payload_type as string] || PAYLOAD_TYPE_META.generic : null
  const PayloadIcon = meta?.icon ?? ShieldCheck

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-muted">
            {isAction ? <PayloadIcon className="size-3 text-muted-foreground" /> : isEmail ? <Mail className="size-3 text-muted-foreground" /> : <ShieldCheck className="size-3 text-muted-foreground" />}
          </div>
          <span className="text-sm font-medium">{approval.agent.name}</span>
          <span className="text-xs text-muted-foreground">wants to</span>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {isAction ? (approval.payload_type as string).replace(/_/g, " ") : approval.tool_name.replace("_", " ")}
          </Badge>
          {approval.risk_tier && approval.risk_tier !== "medium" && (
            <Badge variant="secondary" className={`font-mono text-[10px] ${approval.risk_tier === "high" ? "bg-red-500/10 text-red-400 border-red-400/20" : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"}`}>
              {approval.risk_tier}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="size-2.5" />
            {timeAgo(approval.created_at)}
          </span>
        </div>
        <div className="flex gap-1.5">
          {isAction && approval.options && approval.options.length > 0 ? (
            <>
              {approval.options.map((opt) => {
                const isReject = opt.value === "reject" || opt.value === "rejected" || opt.value === "cancel"
                return (
                  <Button
                    key={opt.value}
                    variant={isReject ? "outline" : "default"}
                    size="sm"
                    className="h-7 text-xs px-3"
                    onClick={() => onAction(approval.id, isReject ? "rejected" : "approved", opt.value)}
                  >
                    {opt.label}
                  </Button>
                )
              })}
              {allowAmend && (
                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setAmendOpen(!amendOpen)}>
                  <Pencil className="size-3" />
                </Button>
              )}
            </>
          ) : (
            <>
              <Button size="sm" className="h-7 text-xs px-3" onClick={() => onAction(approval.id, "approved")}>
                <Check className="size-3 mr-1" />
                Send
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => onAction(approval.id, "rejected")}>
                <X className="size-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {isAction && approval.summary && (
        <div className="px-4 pt-3 text-sm font-medium text-foreground">{approval.summary}</div>
      )}

      {isAction && (
        <ActionPayloadPreview payloadType={approval.payload_type as string} payload={payload} />
      )}

      {amendOpen && (
        <div className="px-4 pb-3 space-y-2 border-t border-border pt-3">
          <textarea
            value={amendText}
            onChange={(e) => setAmendText(e.target.value)}
            placeholder="What should change? e.g. 'tighten the headline; drop the second paragraph'"
            className="w-full min-h-[80px] rounded-md border bg-background p-2 text-xs"
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setAmendOpen(false); setAmendText("") }}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!amendText.trim()}
              onClick={() => onAction(approval.id, "rejected", "edit", amendText.trim())}
            >
              Send edit
            </Button>
          </div>
        </div>
      )}

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
          <AttachmentChips attachments={approval.attachments} />
        </div>
      )}

      {!isEmail && !isAction && (
        <div className="px-4 py-3">
          {approval.context && <p className="text-sm text-muted-foreground mb-2">{approval.context}</p>}
          <pre className="text-xs text-muted-foreground bg-muted p-2.5 rounded overflow-auto max-h-24 font-mono">
            {JSON.stringify(approval.tool_input, null, 2)}
          </pre>
          <AttachmentChips attachments={approval.attachments} />
        </div>
      )}
    </div>
  )
}

const PAYLOAD_TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  linkedin_post:        { icon: Linkedin,        label: "LinkedIn post" },
  tweet:                { icon: Twitter,         label: "Tweet" },
  email_draft:          { icon: Mail,            label: "Email draft" },
  cold_email_bulk:      { icon: Mails,           label: "Bulk email" },
  spend_request:        { icon: DollarSign,      label: "Spend request" },
  external_share:       { icon: Share2,          label: "External share" },
  destructive_action:   { icon: AlertTriangle,   label: "Destructive action" },
  generic:              { icon: FileText,        label: "Action" },
}

function ActionPayloadPreview({ payloadType, payload }: { payloadType: string; payload: Record<string, unknown> }) {
  const stripped: Record<string, unknown> = { ...payload }
  delete stripped._allow_amendment
  delete stripped._origin

  if (payloadType === "linkedin_post" || payloadType === "tweet") {
    const text = String(stripped.text || "")
    const mediaUrl = stripped.media_url as string | undefined
    return (
      <div className="px-4 py-3 space-y-3">
        {text && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
            {text}
          </div>
        )}
        {mediaUrl && (
          <img src={mediaUrl} alt="Preview" className="max-h-48 rounded border object-contain" />
        )}
      </div>
    )
  }

  if (payloadType === "email_draft") {
    return (
      <div className="px-4 py-3 space-y-2.5">
        <div className="space-y-1 text-xs">
          <FieldRow label="To" value={stripped.to as string} />
          <FieldRow label="Subj" value={stripped.subject as string} />
        </div>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto border-t border-border pt-2.5">
          {String(stripped.body || "")}
        </div>
      </div>
    )
  }

  if (payloadType === "cold_email_bulk") {
    const items = (stripped.items as Array<Record<string, unknown>>) || []
    return (
      <div className="px-4 py-3 space-y-2 max-h-72 overflow-y-auto">
        <p className="text-xs text-muted-foreground">{items.length} email(s)</p>
        {items.slice(0, 5).map((item, i) => (
          <div key={i} className="rounded border bg-muted/30 p-2 text-xs">
            <div className="flex justify-between font-medium"><span>{String(item.to || "")}</span><span className="text-muted-foreground">{String(item.subject || "")}</span></div>
            <div className="mt-1 text-muted-foreground line-clamp-3">{String(item.body || "")}</div>
          </div>
        ))}
        {items.length > 5 && <p className="text-xs text-muted-foreground">+ {items.length - 5} more …</p>}
      </div>
    )
  }

  if (payloadType === "spend_request") {
    return (
      <div className="px-4 py-3 space-y-1 text-sm">
        <div className="text-2xl font-semibold">${String(stripped.amount_usd || "—")}</div>
        <div className="text-xs text-muted-foreground">{String(stripped.vendor || "")}</div>
        {stripped.purpose && <div className="text-sm">{String(stripped.purpose)}</div>}
      </div>
    )
  }

  return (
    <div className="px-4 py-3">
      <pre className="text-xs text-muted-foreground bg-muted p-2.5 rounded overflow-auto max-h-48 font-mono whitespace-pre-wrap">
        {JSON.stringify(stripped, null, 2)}
      </pre>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex gap-3">
      <span className="w-10 text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
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
          <AttachmentChips attachments={approval.attachments} />
        </div>
      )}

      {expanded && !isEmail && (
        <div className="px-4 py-3 border-t border-border">
          <pre className="text-xs text-muted-foreground bg-muted p-2.5 rounded overflow-auto max-h-24 font-mono">
            {JSON.stringify(approval.tool_input, null, 2)}
          </pre>
          <AttachmentChips attachments={approval.attachments} />
        </div>
      )}
    </div>
  )
}
