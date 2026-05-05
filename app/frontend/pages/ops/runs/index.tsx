import { Head, router, Link } from "@inertiajs/react"
import { Activity, CheckCircle2, XCircle, Clock, Zap, TrendingDown } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"

interface Run {
  id: number
  created_at: string
  agent: { id: number; name: string; slug: string } | null
  action: string
  status: string | null
  duration_ms: number | null
  total_cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
  was_resume: boolean
  routed_toolkits: string[] | null
  task_id: number | null
  job_id: string | null
  model_id: string | null
  tool_call_count: number
}

interface Props {
  runs: Run[]
  totals: {
    count: number
    total_cost_usd: number
    avg_duration_ms: number
    failed_count: number
    cache_read_total: number
    cache_create_total: number
  }
  agents: { id: number; name: string; slug: string }[]
  filters: { agent_id?: string; status?: string; job_type?: string; min_duration_ms?: string }
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "—"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function fmtCost(usd: number | null): string {
  if (usd == null) return "—"
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}

function fmtTokens(n: number | null): string {
  if (!n) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

const JOB_TYPE_LABELS: Record<string, string> = {
  inbound_message: "Inbound",
  task_assignment: "Task",
  scheduled_task: "Scheduled",
  heartbeat: "Heartbeat",
}

export default function OpsRunsIndex({ runs, totals, agents, filters }: Props) {
  function updateFilter(key: string, value: string) {
    const params = { ...filters } as Record<string, string | undefined>
    params[key] = value === "all" ? undefined : value
    router.get("/ops/runs", params, { preserveState: true, preserveScroll: true })
  }

  return (
    <AppLayout
      crumbs={[
        { label: "Control plane", href: "/" },
        { label: "Ops" },
        { label: "Runs" },
      ]}
      topBarActions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="h-8">
            <Link href="/ops/traces">Trace tree</Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="h-8">
            <Link href="/ops/cost">Cost dashboard</Link>
          </Button>
        </div>
      }
    >
      <Head title="Runs — Ops" />

      <PageHeader
        eyebrow="Observability"
        title="Agent runs"
        description="Every agent execution with timing, cost, and tool calls — trace any run end-to-end."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard icon={Activity} label="Runs" value={totals.count.toString()} />
        <StatCard icon={Zap} label="Total cost" value={fmtCost(totals.total_cost_usd)} />
        <StatCard icon={Clock} label="Avg duration" value={fmtDuration(totals.avg_duration_ms)} />
        <StatCard icon={XCircle} label="Failed" value={totals.failed_count.toString()} tone={totals.failed_count > 0 ? "danger" : "default"} />
        <StatCard icon={TrendingDown} label="Cache reads" value={fmtTokens(totals.cache_read_total)} tone="good" />
      </div>

      {/* Filters */}
      {(() => {
        const activeCount =
          (filters.agent_id && filters.agent_id !== "all" ? 1 : 0) +
          (filters.status && filters.status !== "all" ? 1 : 0) +
          (filters.job_type && filters.job_type !== "all" ? 1 : 0)
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
            <span className="overline ml-1 mr-2">Filter</span>
            <Select onValueChange={(v) => updateFilter("agent_id", v)} value={filters.agent_id || "all"}>
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select onValueChange={(v) => updateFilter("status", v)} value={filters.status || "all"}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <Select onValueChange={(v) => updateFilter("job_type", v)} value={filters.job_type || "all"}>
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue placeholder="Job type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                <SelectItem value="inbound_message">Inbound</SelectItem>
                <SelectItem value="task_assignment">Task</SelectItem>
                <SelectItem value="scheduled_task">Scheduled</SelectItem>
                <SelectItem value="heartbeat">Heartbeat</SelectItem>
              </SelectContent>
            </Select>

            {activeCount > 0 && (
              <button
                onClick={() =>
                  router.get("/ops/runs", {}, { preserveState: true })
                }
                className="ml-auto rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Clear · {activeCount}
              </button>
            )}
          </div>
        )
      })()}

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border border-dashed border-border rounded-lg">
          <Activity className="size-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium mb-1">No runs match your filters</p>
          <p className="text-xs text-muted-foreground">Try clearing filters or running an agent</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
                <th className="text-right px-3 py-2 font-medium">Cost</th>
                <th className="text-right px-3 py-2 font-medium">Tools</th>
                <th className="text-right px-3 py-2 font-medium">Cache</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.visit(`/ops/runs/${r.id}`)}
                >
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.agent?.name || "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline" className="text-[10px]">{JOB_TYPE_LABELS[r.action] || r.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{fmtDuration(r.duration_ms)}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{fmtCost(r.total_cost_usd)}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums">{r.tool_call_count}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {r.cache_read_input_tokens ? fmtTokens(r.cache_read_input_tokens) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "success" ? (
                      <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" /> success
                      </Badge>
                    ) : r.status === "failed" ? (
                      <Badge variant="outline" className="text-[10px] gap-1 border-red-500/30 text-red-600 dark:text-red-400">
                        <XCircle className="size-3" /> failed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{r.status || "—"}</Badge>
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

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone?: "default" | "good" | "danger"
}) {
  const toneClasses =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "danger" ? "text-red-600 dark:text-red-400" : "text-foreground"

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${toneClasses}`}>{value}</div>
    </div>
  )
}
