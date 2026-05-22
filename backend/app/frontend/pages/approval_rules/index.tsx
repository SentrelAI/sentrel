import { Head, router } from "@inertiajs/react"
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Bot,
  Code2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Beaker,
  Loader2,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"

interface Agent { id: string; name: string; slug: string; role: string }

interface Rule {
  id: number
  label: string | null
  agent: { id: string; name: string; slug: string } | null
  payload_type: string | null
  auto_decision: "approve" | "reject"
  enabled: boolean
  predicate: Record<string, unknown>
  created_at: string
  updated_at: string
}

interface Props {
  rules: Rule[]
  agents: Agent[]
  payload_types: string[]
}

interface TestResult {
  window_days: number
  total: number
  matched: number
  truncated: boolean
  sample: Array<{
    id: number
    agent_name: string | null
    payload_type: string | null
    created_at: string
    status: string
    tool_input: Record<string, unknown>
  }>
  error?: string
}

const PREDICATE_EXAMPLES: Array<{ label: string; value: string }> = [
  { label: "Auto-approve up to 3 LinkedIn posts/day",          value: JSON.stringify({ max_per_day: 3 }, null, 2) },
  { label: "Auto-approve emails under $5",                     value: JSON.stringify({ field: "amount_usd", lte: 5 }, null, 2) },
  { label: "Auto-approve to internal domain only",             value: JSON.stringify({ field: "to", match: "@scribemd\\.ai$" }, null, 2) },
  { label: "Auto-reject if subject contains 'discount'",       value: JSON.stringify({ field: "subject", contains: "discount" }, null, 2) },
  { label: "Combine: internal AND under $5",                   value: JSON.stringify({ all_of: [{ field: "to", match: "@scribemd\\.ai$" }, { field: "amount_usd", lte: 5 }] }, null, 2) },
]

export default function ApprovalRulesIndex({ rules, agents, payload_types }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Rule | null>(null)

  const orgWide = rules.filter((r) => !r.agent)
  const perAgent = groupBy(rules.filter((r) => r.agent), (r) => r.agent!.id)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(rule: Rule) {
    setEditing(rule)
    setDialogOpen(true)
  }
  function toggleRule(rule: Rule) {
    router.post(`/approval_rules/${rule.id}/toggle`, {}, { preserveScroll: true })
  }
  function destroyRule(rule: Rule) {
    if (!confirm(`Delete rule "${rule.label || ruleSummary(rule)}"?`)) return
    router.delete(`/approval_rules/${rule.id}`, { preserveScroll: true })
  }

  return (
    <AppLayout>
      <Head title="Approval rules" />
      <div className="mx-auto max-w-5xl p-6">
        <PageHeader
          eyebrow="Controls"
          title="Auto-approval rules"
          description="Rules let agents skip the human-in-the-loop for low-risk requests. The engine checks every request_approval call against these before pausing. Rules with no agent apply org-wide; agent-specific rules win first."
          action={
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 size-4" />
              New rule
            </Button>
          }
        />

        {rules.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No rules yet"
            description="Create your first rule to start auto-resolving low-risk approvals. Common patterns: cap a daily count, allow only internal recipients, or approve everything under a dollar threshold."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 size-4" /> Create first rule
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {orgWide.length > 0 && (
              <RuleGroup title="Org-wide" subtitle="Apply to every agent in this workspace.">
                {orgWide.map((r) => (
                  <RuleCard key={r.id} rule={r} onEdit={openEdit} onToggle={toggleRule} onDestroy={destroyRule} />
                ))}
              </RuleGroup>
            )}
            {Object.entries(perAgent).map(([agentId, agentRules]) => {
              const agent = agentRules[0].agent!
              return (
                <RuleGroup
                  key={agentId}
                  title={agent.name}
                  subtitle={`${agentRules.length} rule${agentRules.length === 1 ? "" : "s"} scoped to this agent`}
                  icon={<Bot className="size-4 text-muted-foreground" />}
                >
                  {agentRules.map((r) => (
                    <RuleCard key={r.id} rule={r} onEdit={openEdit} onToggle={toggleRule} onDestroy={destroyRule} />
                  ))}
                </RuleGroup>
              )
            })}
          </div>
        )}
      </div>

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        agents={agents}
        payloadTypes={payload_types}
      />
    </AppLayout>
  )
}

function RuleGroup({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">· {subtitle}</span>}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function RuleCard({
  rule,
  onEdit,
  onToggle,
  onDestroy,
}: {
  rule: Rule
  onEdit: (r: Rule) => void
  onToggle: (r: Rule) => void
  onDestroy: (r: Rule) => void
}) {
  const [showPredicate, setShowPredicate] = useState(false)
  const isApprove = rule.auto_decision === "approve"
  const Icon = isApprove ? CheckCircle2 : XCircle
  const decisionColor = isApprove
    ? "text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
    : "text-red-700 dark:text-red-400 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30"

  return (
    <Card className={rule.enabled ? "" : "opacity-60"}>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className={`size-4 ${isApprove ? "text-green-600" : "text-red-600"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{rule.label || ruleSummary(rule)}</h3>
              {!rule.enabled && <Badge variant="outline" className="text-xs">disabled</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={`text-xs ${decisionColor}`}>
                auto-{rule.auto_decision}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {rule.payload_type || "any payload type"}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onToggle(rule)} title={rule.enabled ? "Disable" : "Enable"}>
              {rule.enabled ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4 text-muted-foreground" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(rule)} title="Edit">
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDestroy(rule)} title="Delete">
              <Trash2 className="size-3.5 text-red-600" />
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowPredicate(!showPredicate)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showPredicate ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          <Code2 className="size-3" /> Predicate JSON
        </button>
        {showPredicate && (
          <pre className="mt-2 max-h-48 overflow-auto rounded border bg-muted/40 p-2 text-[11px] font-mono">
            {JSON.stringify(rule.predicate, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

function RuleDialog({
  open,
  onOpenChange,
  editing,
  agents,
  payloadTypes,
}: {
  open: boolean
  onOpenChange: (b: boolean) => void
  editing: Rule | null
  agents: Agent[]
  payloadTypes: string[]
}) {
  const [agentId, setAgentId] = useState<string>(editing?.agent?.id || "any")
  const [payloadType, setPayloadType] = useState<string>(editing?.payload_type || "any")
  const [autoDecision, setAutoDecision] = useState<"approve" | "reject">(editing?.auto_decision || "approve")
  const [label, setLabel] = useState<string>(editing?.label || "")
  const [predicate, setPredicate] = useState<string>(
    editing ? JSON.stringify(editing.predicate, null, 2) : "{}",
  )
  const [submitting, setSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  // Reset whenever the dialog target changes (open with a different editing
  // row, or switch from edit → create).
  useEffect(() => {
    if (!open) return
    setTestResult(null)
    if (editing) {
      setAgentId(editing.agent?.id || "any")
      setPayloadType(editing.payload_type || "any")
      setAutoDecision(editing.auto_decision)
      setLabel(editing.label || "")
      setPredicate(JSON.stringify(editing.predicate, null, 2))
    } else {
      setAgentId("any")
      setPayloadType("any")
      setAutoDecision("approve")
      setLabel("")
      setPredicate("{}")
    }
  }, [open, editing])

  async function runTest() {
    // Validate JSON first so the user sees the parse error inline,
    // same as on submit.
    let parsed: unknown
    try {
      parsed = JSON.parse(predicate)
    } catch (err) {
      toast.error(`Predicate JSON invalid: ${(err as Error).message}`)
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
      const res = await fetch("/approval_rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, Accept: "application/json" },
        body: JSON.stringify({
          predicate: parsed,
          payload_type: payloadType === "any" ? null : payloadType,
          agent_id: agentId === "any" ? null : agentId,
          days: 30,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || `Test failed (${res.status})`)
      } else {
        setTestResult(data)
      }
    } catch (err) {
      toast.error((err as Error).message || "Network error")
    } finally {
      setTesting(false)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Validate JSON before posting; surface error inline so the user can fix it.
    try {
      JSON.parse(predicate)
    } catch (err) {
      toast.error(`Predicate JSON invalid: ${(err as Error).message}`)
      return
    }
    setSubmitting(true)
    const payload = {
      agent_id: agentId === "any" ? "" : agentId,
      payload_type: payloadType === "any" ? "" : payloadType,
      auto_decision: autoDecision,
      label: label.trim(),
      predicate,
      enabled: editing ? editing.enabled : true,
    }
    const opts = {
      preserveScroll: true,
      onFinish: () => setSubmitting(false),
      onSuccess: () => onOpenChange(false),
    }
    if (editing) {
      router.patch(`/approval_rules/${editing.id}`, payload, opts)
    } else {
      router.post("/approval_rules", payload, opts)
    }
  }

  function pickExample(value: string) {
    setPredicate(value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit rule" : "New approval rule"}</DialogTitle>
          <DialogDescription>
            Rules are matched first by specificity (agent before org-wide, specific payload type before "any"). The first match wins.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="agent">Scope</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger id="agent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Org-wide (all agents)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payload_type">Payload type</Label>
              <Select value={payloadType} onValueChange={setPayloadType}>
                <SelectTrigger id="payload_type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any payload type</SelectItem>
                  {payloadTypes.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="label">Label (shown in the audit trail)</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Auto-approve up to 3 LinkedIn posts/day"
            />
          </div>

          <div>
            <Label>Decision</Label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setAutoDecision("approve")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                  autoDecision === "approve"
                    ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <CheckCircle2 className="mr-1.5 inline size-4" /> Auto-approve
              </button>
              <button
                type="button"
                onClick={() => setAutoDecision("reject")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                  autoDecision === "reject"
                    ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                    : "border-border bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                <XCircle className="mr-1.5 inline size-4" /> Auto-reject
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="predicate">Predicate (JSON)</Label>
              <span className="text-xs text-muted-foreground">Empty {"{}"} = match everything</span>
            </div>
            <textarea
              id="predicate"
              value={predicate}
              onChange={(e) => setPredicate(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            />
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Quick start</div>
              <div className="flex flex-wrap gap-1">
                {PREDICATE_EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => pickExample(ex.value)}
                    className="rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {testResult && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <Beaker className="size-3.5" />
                {testResult.matched} / {testResult.total} approvals in the last {testResult.window_days} days would match
                {testResult.truncated && <span className="font-normal text-muted-foreground"> (capped at 500)</span>}
              </div>
              {testResult.matched > 0 ? (
                <ul className="mt-2 space-y-1 text-[11px]">
                  {testResult.sample.map((s) => (
                    <li key={s.id} className="truncate">
                      <span className="font-mono text-muted-foreground">#{s.id}</span>{" "}
                      <span className="font-medium">{s.agent_name || "—"}</span>{" "}
                      <span className="text-muted-foreground">· {s.payload_type || "any"}</span>{" "}
                      <span className="text-muted-foreground">· {new Date(s.created_at).toLocaleDateString()}</span>{" "}
                      <span className="text-muted-foreground">· {s.status}</span>
                    </li>
                  ))}
                  {testResult.matched > testResult.sample.length && (
                    <li className="text-muted-foreground">…and {testResult.matched - testResult.sample.length} more</li>
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">No approvals in the window would have matched. Tighten the predicate or widen the scope.</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={runTest} disabled={testing}>
              {testing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Beaker className="mr-1.5 size-3.5" />}
              {testing ? "Testing…" : "Test against history"}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save changes" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ruleSummary(rule: Rule): string {
  const verb = rule.auto_decision === "approve" ? "Approve" : "Reject"
  const scope = rule.agent ? rule.agent.name : "all agents"
  const type = rule.payload_type || "any payload"
  return `${verb} ${type} for ${scope}`
}

function groupBy<T, K extends string | number>(arr: T[], fn: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const item of arr) {
    const k = fn(item)
    ;(out[k] ||= []).push(item)
  }
  return out
}
