import { Head, router } from "@inertiajs/react"
import { ShieldCheck, Check, X, Mail } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

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

export default function ApprovalsIndex({ approvals }: { approvals: Approval[] }) {
  const pending = approvals.filter((a) => a.status === "pending")
  const reviewed = approvals.filter((a) => a.status !== "pending")

  function handleApproval(id: number, status: "approved" | "rejected") {
    router.patch(`/pending_approvals/${id}`, { status }, { preserveScroll: true })
  }

  return (
    <AppLayout>
      <Head title="Approvals" />

      <PageHeader title="Approvals" description="Review actions your agents want to take" />

      {pending.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#D4A843]" />
            Pending ({pending.length})
          </h2>
          <div className="space-y-3">
            {pending.map((approval) => (
              <Card key={approval.id} className="border-[var(--color-gold-border)]">
                <CardContent className="flex items-start justify-between py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{approval.agent.name}</span>
                      <span className="text-muted-foreground">wants to</span>
                      <Badge variant="secondary" className="font-mono text-xs">{approval.tool_name}</Badge>
                    </div>
                    {approval.tool_name === "send_email" ? (
                      <EmailPreview data={approval.tool_input as Record<string, unknown>} />
                    ) : (
                      <>
                        {approval.context && (
                          <p className="text-sm text-muted-foreground mt-1">{approval.context}</p>
                        )}
                        <pre className="text-xs text-muted-foreground mt-2 bg-muted p-2 rounded overflow-auto max-h-24">
                          {JSON.stringify(approval.tool_input, null, 2)}
                        </pre>
                      </>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(approval.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button size="sm" onClick={() => handleApproval(approval.id, "approved")}>
                      <Check className="size-4 mr-1" />
                      Approve
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleApproval(approval.id, "rejected")}>
                      <X className="size-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {reviewed.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 text-muted-foreground">History</h2>
          <div className="space-y-2">
            {reviewed.map((approval) => (
              <Card key={approval.id} className="opacity-50">
                <CardContent className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{approval.agent.name}</span>
                    <Badge variant="secondary" className="font-mono text-xs">{approval.tool_name}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={approval.status === "approved" ? "default" : "destructive"}>
                      {approval.status}
                    </Badge>
                    {approval.reviewed_by && (
                      <span className="text-xs text-muted-foreground">by {approval.reviewed_by.name}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {approvals.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No approvals yet"
          description="When agents need permission to act, approval requests will appear here"
        />
      )}
    </AppLayout>
  )
}

function EmailPreview({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mt-2 rounded-lg border bg-white p-3 space-y-2 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="size-3.5" />
        Email Draft
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex gap-2">
          <span className="font-medium w-12 shrink-0 text-muted-foreground">From</span>
          <span>{data.from_name as string} &lt;{data.from_address as string}&gt;</span>
        </div>
        <div className="flex gap-2">
          <span className="font-medium w-12 shrink-0 text-muted-foreground">To</span>
          <span>{Array.isArray(data.to) ? (data.to as string[]).join(", ") : data.to as string}</span>
        </div>
        {data.cc && (data.cc as string[]).length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium w-12 shrink-0 text-muted-foreground">CC</span>
            <span>{(data.cc as string[]).join(", ")}</span>
          </div>
        )}
        {data.bcc && (data.bcc as string[]).length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium w-12 shrink-0 text-muted-foreground">BCC</span>
            <span>{(data.bcc as string[]).join(", ")}</span>
          </div>
        )}
      </div>
      <div className="border-t pt-2">
        <p className="font-medium text-sm">{data.subject as string}</p>
      </div>
      <div className="border-t pt-2 text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
        {data.body_text as string || data.body_html as string}
      </div>
    </div>
  )
}
