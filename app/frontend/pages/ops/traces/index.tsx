import { useState } from "react"
import { Head, Link, router } from "@inertiajs/react"
import { ChevronRight, ChevronDown, GitBranch, CheckCircle2, XCircle, Clock, Users } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

interface TraceSummary {
  id: number
  created_at: string
  root_run: RunRow
  descendant_count: number
  agents_involved: number
  total_cost_usd: number
  total_duration_ms: number
  status: "success" | "failed" | "mixed" | "running"
  task_id: number | null
}

interface Props {
  traces: TraceSummary[]
  agents: { id: number; name: string; slug: string }[]
  filters: { agent_id?: string; status?: string }
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

function statusBadge(status: string | null) {
  const cls =
    status === "success" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" :
    status === "failed"  ? "bg-red-500/10 text-red-600 border-red-500/30" :
    status === "mixed"   ? "bg-amber-500/10 text-amber-600 border-amber-500/30" :
                           "bg-muted text-muted-foreground"
  const Icon = status === "success" ? CheckCircle2 : status === "failed" ? XCircle : Clock
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", cls)}>
      <Icon className="size-2.5" /> {status || "—"}
    </Badge>
  )
}

export default function TracesIndex({ traces, agents, filters }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applyFilter(key: string, value: string | undefined) {
    const q: Record<string, string> = { ...filters as Record<string, string> }
    if (!value || value === "all") delete q[key]
    else q[key] = value
    router.get("/ops/traces", q, { preserveScroll: true, preserveState: false })
  }

  return (
    <AppLayout>
      <Head title="Ops · Traces" />
      <PageHeader
        title="Traces"
        description="One row per user request. Expand to see the full delegation tree of every agent that touched it."
      />

      <div className="mb-4 flex items-center gap-2">
        <Select value={filters.agent_id || "all"} onValueChange={(v) => applyFilter("agent_id", v)}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="All agents" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {agents.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status || "all"} onValueChange={(v) => applyFilter("status", v)}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto" asChild>
          <Link href="/ops/runs">View flat run list →</Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {traces.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No traces yet — send a user request to any agent and it'll show here.
          </div>
        )}
        {traces.map((t) => {
          const isOpen = expanded.has(t.id)
          return (
            <div key={t.id}>
              <button
                type="button"
                onClick={() => toggle(t.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition"
              >
                {t.descendant_count > 0
                  ? (isOpen ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />)
                  : <span className="size-4 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium truncate">{t.root_run.agent?.name || "Unknown"}</span>
                    <span className="text-muted-foreground text-xs">·</span>
                    <span className="text-muted-foreground text-xs font-mono uppercase">{t.root_run.action}</span>
                    {statusBadge(t.status)}
                  </div>
                  {t.root_run.response_preview && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {t.root_run.response_preview}
                    </div>
                  )}
                </div>
                <div className="hidden md:flex items-center gap-3 text-[11px] font-mono text-muted-foreground shrink-0">
                  {t.descendant_count > 0 && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="size-3" />
                      {t.descendant_count} sub-runs
                    </span>
                  )}
                  {t.agents_involved > 1 && (
                    <span className="flex items-center gap-1">
                      <Users className="size-3" />
                      {t.agents_involved} agents
                    </span>
                  )}
                  <span>{fmtMs(t.total_duration_ms)}</span>
                  <span>{fmtUSD(t.total_cost_usd)}</span>
                </div>
                <Link
                  href={`/ops/traces/${t.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                >
                  Detail →
                </Link>
              </button>

              {isOpen && t.descendant_count > 0 && (
                <div className="border-t border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  Open the detail page for the full tree, timing, tool calls, and per-run cost breakdown.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </AppLayout>
  )
}
