import { Head, Link } from "@inertiajs/react"
import { ChevronRight, CheckCircle2, XCircle, Clock, GitBranch } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface RunRow {
  id: number
  created_at: string
  agent: { id: number; name: string; slug: string; role: string } | null
  action: string
  status: string | null
  duration_ms: number | null
  total_cost_usd: number | null
  task_id: number | null
  tool_call_count: number
  response_preview?: string | null
}

interface TaskNode {
  task: {
    id: number
    title: string
    status: string
    priority: string | null
    agent_id: number | null
    assigned_by_agent_id: number | null
    created_at: string
  }
  runs: RunRow[]
  children: TaskNode[]
}

interface Trace {
  id: number
  created_at: string
  root_run: RunRow
  descendant_count: number
  agents_involved: number
  total_cost_usd: number
  total_duration_ms: number
  status: string
  task_id: number | null
  runs: RunRow[]
  tree: {
    root_run: RunRow
    top_level_tasks: TaskNode[]
  }
}

function fmtMs(ms: number | null | undefined) {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function fmtUSD(n: number | null | undefined) {
  if (!n || n < 0.0001) return "—"
  if (n < 0.01) return `$${(n * 1000).toFixed(2)}m`
  return `$${n.toFixed(4)}`
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === "success") return <CheckCircle2 className="size-3.5 text-emerald-500" />
  if (status === "failed")  return <XCircle className="size-3.5 text-red-500" />
  return <Clock className="size-3.5 text-muted-foreground" />
}

function RunRowDisplay({ run, indent = 0 }: { run: RunRow; indent?: number }) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 text-xs hover:bg-muted/30 px-2 rounded"
      style={{ paddingLeft: `${0.5 + indent * 1.25}rem` }}
    >
      <StatusIcon status={run.status} />
      <span className="font-medium text-foreground/90">{run.agent?.name || "?"}</span>
      <span className="text-muted-foreground/60">·</span>
      <span className="font-mono text-[10px] uppercase text-muted-foreground">{run.action}</span>
      <Link
        href={`/ops/runs/${run.id}`}
        className="text-[10px] text-muted-foreground hover:text-foreground"
      >
        #{run.id}
      </Link>
      {run.tool_call_count > 0 && (
        <span className="text-[10px] text-muted-foreground">{run.tool_call_count} tools</span>
      )}
      <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
        <span>{fmtMs(run.duration_ms)}</span>
        <span>{fmtUSD(run.total_cost_usd)}</span>
      </div>
    </div>
  )
}

function TaskNodeDisplay({ node, indent }: { node: TaskNode; indent: number }) {
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 text-xs"
        style={{ paddingLeft: `${0.5 + indent * 1.25}rem` }}
      >
        <ChevronRight className="size-3 text-muted-foreground" />
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] gap-1 uppercase tracking-wide",
            node.task.status === "done" ? "text-emerald-600 border-emerald-500/30" :
            node.task.status === "failed" || node.task.status === "cancelled" ? "text-red-600 border-red-500/30" :
            "text-muted-foreground",
          )}
        >
          {node.task.status}
        </Badge>
        <span className="text-foreground/90 truncate">{node.task.title}</span>
        <Link
          href={`/tasks/${node.task.id}`}
          className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
        >
          tsk_{node.task.id} →
        </Link>
      </div>
      {node.runs.map((r) => (
        <RunRowDisplay key={r.id} run={r} indent={indent + 1} />
      ))}
      {node.children.map((c) => (
        <TaskNodeDisplay key={c.task.id} node={c} indent={indent + 1} />
      ))}
    </div>
  )
}

export default function TracesShow({ trace }: { trace: Trace }) {
  return (
    <AppLayout>
      <Head title={`Trace #${trace.id}`} />
      <PageHeader
        title={`Trace #${trace.id}`}
        description={`Started ${new Date(trace.created_at).toLocaleString()} by ${trace.root_run.agent?.name || "?"}.`}
      />

      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Agents involved" value={String(trace.agents_involved)} />
        <Stat label="Sub-runs" value={String(trace.descendant_count)} />
        <Stat label="Total duration" value={fmtMs(trace.total_duration_ms)} />
        <Stat label="Total cost" value={fmtUSD(trace.total_cost_usd)} />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-muted/30 text-[11px] font-mono uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <GitBranch className="size-3" /> Delegation tree
        </div>
        <div className="p-2 space-y-0.5">
          <RunRowDisplay run={trace.tree.root_run} indent={0} />
          {trace.tree.top_level_tasks.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic px-3 py-2">
              No sub-tasks were spawned. This was a single-agent run.
            </div>
          )}
          {trace.tree.top_level_tasks.map((t) => (
            <TaskNodeDisplay key={t.task.id} node={t} indent={1} />
          ))}
        </div>
      </div>
    </AppLayout>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  )
}
