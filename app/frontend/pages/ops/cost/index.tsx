import { Head, router, Link } from "@inertiajs/react"
import { ArrowLeft, Zap, TrendingDown, Activity } from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Props {
  days: number
  total_cost_usd: number
  total_runs: number
  cache_savings_usd: number
  cache_read_tokens: number
  daily: { date: string; agent_id: number; cost: number }[]
  per_agent: { agent_id: number; agent_name: string | null; cost: number }[]
  per_job_type: { action: string; cost: number }[]
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(4)}`
}

export default function OpsCostIndex({ days, total_cost_usd, total_runs, cache_savings_usd, cache_read_tokens, daily, per_agent, per_job_type }: Props) {
  function updateDays(v: string) {
    router.get("/ops/cost", { days: v }, { preserveState: true })
  }

  // Rollup daily across all agents for the chart
  const dailyTotals = new Map<string, number>()
  for (const d of daily) {
    dailyTotals.set(d.date, (dailyTotals.get(d.date) || 0) + d.cost)
  }
  const chartData = [...dailyTotals.entries()].sort(([a], [b]) => a.localeCompare(b))
  const maxCost = Math.max(...chartData.map(([, c]) => c), 0.0001)

  return (
    <AppLayout>
      <Head title="Cost — Ops" />

      <div className="flex items-center gap-3 mb-5">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ops/runs"><ArrowLeft className="size-4" /> Back</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Cost</h1>
          <p className="text-sm text-muted-foreground mt-0.5">API spend, cache savings, per-agent breakdown</p>
        </div>
        <Select onValueChange={updateDays} defaultValue={String(days)}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatBig icon={Zap} label="Total spent" value={fmtCost(total_cost_usd)} sublabel={`over ${days} days`} />
        <StatBig icon={Activity} label="Runs" value={total_runs.toString()} sublabel={`${(total_cost_usd / Math.max(1, total_runs)).toFixed(4)}$ avg`} />
        <StatBig icon={TrendingDown} label="Cache savings" value={fmtCost(cache_savings_usd)} sublabel={`${(cache_read_tokens / 1_000_000).toFixed(2)}M cached reads`} tone="good" />
        <StatBig
          icon={TrendingDown}
          label="Effective rate"
          value={`${((cache_savings_usd / Math.max(0.0001, total_cost_usd + cache_savings_usd)) * 100).toFixed(0)}%`}
          sublabel="saved via cache"
          tone="good"
        />
      </div>

      {/* Daily chart */}
      <div className="rounded-lg border border-border p-4 mb-6">
        <h2 className="text-sm font-medium mb-3">Daily spend</h2>
        {chartData.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-6 text-center">No activity in this period</div>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {chartData.map(([date, cost]) => {
              const height = Math.max(4, (cost / maxCost) * 100)
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1 group">
                  <div className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 tabular-nums whitespace-nowrap">
                    {fmtCost(cost)}
                  </div>
                  <div
                    className="w-full bg-blue-500 hover:bg-blue-600 rounded-t transition-colors"
                    style={{ height: `${height}%` }}
                    title={`${date}: ${fmtCost(cost)}`}
                  />
                  <div className="text-[9px] text-muted-foreground whitespace-nowrap">
                    {new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Per agent */}
        <div className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium mb-3">By agent</h2>
          {per_agent.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No data</div>
          ) : (
            <div className="space-y-2">
              {per_agent.sort((a, b) => b.cost - a.cost).map((row) => {
                const pct = (row.cost / Math.max(0.0001, total_cost_usd)) * 100
                return (
                  <div key={row.agent_id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span>{row.agent_name || `Agent #${row.agent_id}`}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtCost(row.cost)} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Per job type */}
        <div className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium mb-3">By job type</h2>
          {per_job_type.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No data</div>
          ) : (
            <div className="space-y-2">
              {per_job_type.sort((a, b) => b.cost - a.cost).map((row) => {
                const pct = (row.cost / Math.max(0.0001, total_cost_usd)) * 100
                return (
                  <div key={row.action}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize">{row.action.replace(/_/g, " ")}</span>
                      <span className="tabular-nums text-muted-foreground">{fmtCost(row.cost)} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-purple-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}

function StatBig({
  icon: Icon,
  label,
  value,
  sublabel,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sublabel?: string
  tone?: "default" | "good"
}) {
  const toneClasses = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClasses}`}>{value}</div>
      {sublabel && <div className="text-[11px] text-muted-foreground mt-1">{sublabel}</div>}
    </div>
  )
}
