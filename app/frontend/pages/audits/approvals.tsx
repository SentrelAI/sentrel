import { Head, router } from "@inertiajs/react"
import { ShieldCheck, ShieldX, Download, Bot } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface ApprovalRow {
  id: string
  created_at: string
  reviewed_at: string | null
  agent: { id: number; name: string; slug: string; role: string } | null
  tool_name: string | null
  payload_type: string | null
  summary: string | null
  risk_tier: string | null
  status: string | null
  decision: string | null
  decision_text: string | null
  reviewed_by: { id: number; name: string; email: string } | null
  auto_rule_id: string | null
}

interface Props {
  approvals: ApprovalRow[]
  agents: { id: number; name: string; slug: string }[]
  filters: {
    agent_id?: string
    decision?: string
    status?: string
    payload_type?: string
    since?: string
    until?: string
  }
}

const RISK_COLOR: Record<string, string> = {
  low: "text-emerald-500/80",
  medium: "text-amber-500/80",
  high: "text-red-500/90",
}

export default function AuditsApprovals({ approvals, agents, filters }: Props) {
  function setFilter(key: string, value: string) {
    const next = { ...filters, [key]: value || undefined }
    router.get("/audits/approvals", next, { preserveScroll: true })
  }

  return (
    <AppLayout
      crumbs={[{ label: "Audits" }, { label: "Approvals" }]}
    >
      <Head title="Audit · Approvals" />
      <PageHeader
        title="Approval audit"
        description="Every approval decision — manual or auto-resolved by a standing rule."
        action={
          <a href="/audits/approvals.csv" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <Download className="size-3.5 mr-1.5" /> CSV
            </Button>
          </a>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4 px-4 sm:px-6">
        <Select value={filters.agent_id || "all"} onValueChange={(v) => setFilter("agent_id", v === "all" ? "" : v)}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Agent" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.decision || "any"} onValueChange={(v) => setFilter("decision", v === "any" ? "" : v)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Decision" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any decision</SelectItem>
            <SelectItem value="approve">Approved</SelectItem>
            <SelectItem value="reject">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.payload_type || "any"} onValueChange={(v) => setFilter("payload_type", v === "any" ? "" : v)}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any type</SelectItem>
            <SelectItem value="linkedin_post">LinkedIn post</SelectItem>
            <SelectItem value="tweet">Tweet</SelectItem>
            <SelectItem value="email_draft">Email draft</SelectItem>
            <SelectItem value="cold_email_bulk">Cold email batch</SelectItem>
            <SelectItem value="spend_request">Spend</SelectItem>
            <SelectItem value="external_share">External share</SelectItem>
            <SelectItem value="destructive_action">Destructive</SelectItem>
            <SelectItem value="generic">Generic</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="h-8 w-40 text-xs"
          value={filters.since || ""}
          onChange={(e) => setFilter("since", e.target.value)}
          placeholder="Since"
        />
        <Input
          type="date"
          className="h-8 w-40 text-xs"
          value={filters.until || ""}
          onChange={(e) => setFilter("until", e.target.value)}
          placeholder="Until"
        />
      </div>

      <div className="px-4 sm:px-6 pb-8">
        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No approvals match the filters.</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Summary</th>
                  <th className="px-3 py-2 text-left font-medium">Risk</th>
                  <th className="px-3 py-2 text-left font-medium">Decision</th>
                  <th className="px-3 py-2 text-left font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {approvals.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{a.agent?.name || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                      {a.payload_type || a.tool_name || "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[420px] truncate" title={a.summary || ""}>
                      {a.summary || "—"}
                    </td>
                    <td className={`px-3 py-2 font-mono text-[10px] uppercase ${RISK_COLOR[a.risk_tier || ""] || "text-muted-foreground"}`}>
                      {a.risk_tier || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {a.decision === "approve" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/15"><ShieldCheck className="size-3 mr-1" />approved</Badge>
                      ) : a.decision === "reject" ? (
                        <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/15"><ShieldX className="size-3 mr-1" />rejected</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">{a.status || "pending"}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {a.auto_rule_id ? (
                        <span className="inline-flex items-center gap-1 text-[10px]"><Bot className="size-3" /> rule</span>
                      ) : a.reviewed_by ? (
                        a.reviewed_by.name || a.reviewed_by.email
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
