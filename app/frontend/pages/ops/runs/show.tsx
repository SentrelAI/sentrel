import { Head, Link } from "@inertiajs/react"
import { ArrowLeft, CheckCircle2, XCircle, Clock, Zap, Cpu, Wrench, FileText, AlertCircle } from "lucide-react"
import { useState } from "react"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Span {
  id: number
  name: string
  start_ms: number
  end_ms: number | null
  duration_ms: number | null
  meta: Record<string, unknown>
  parent_id: number | null
}

interface ToolCall {
  name: string
}

interface RunDetail {
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
  first_token_ms: number | null
  conversation_id: string | null
  prompt: string | null
  response: string | null
  tool_calls: ToolCall[]
  error: string | null
  session_id: string | null
  spans: Span[]
}

interface Props {
  run: RunDetail
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—"
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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

// Color-code span names by category for the waterfall
function spanColor(name: string): string {
  if (name.startsWith("tool_use:mcp__composio__")) return "bg-purple-500"
  if (name.startsWith("tool_use:WebSearch") || name.startsWith("tool_use:WebFetch")) return "bg-blue-500"
  if (name.startsWith("tool_use:")) return "bg-indigo-500"
  if (name === "agent_loop") return "bg-emerald-500"
  if (name === "runAgent") return "bg-slate-500"
  if (name === "error") return "bg-red-500"
  if (name === "text_block") return "bg-amber-500"
  if (name.startsWith("tool_result:")) return "bg-teal-500"
  return "bg-zinc-400"
}

function spanLabel(name: string): string {
  return name
    .replace("tool_use:mcp__composio__", "🔗 ")
    .replace("tool_use:mcp__", "🔧 ")
    .replace("tool_use:", "🔨 ")
    .replace("tool_result:", "✓ ")
    .replace("agent_loop", "⚙️  Agent loop")
    .replace("runAgent", "🚀 Run")
}

export default function OpsRunsShow({ run }: Props) {
  const [tab, setTab] = useState<"overview" | "prompt" | "response" | "spans">("overview")

  const totalMs = run.duration_ms || 0
  const isFailed = run.status === "failed"

  return (
    <AppLayout>
      <Head title={`Run #${run.id} — Ops`} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/ops/runs"><ArrowLeft className="size-4" /> Back</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Run #{run.id}</h1>
          <p className="text-xs text-muted-foreground">
            {run.agent?.name} · {run.action} · {new Date(run.created_at).toLocaleString()}
          </p>
        </div>
        {isFailed ? (
          <Badge variant="outline" className="gap-1 border-red-500/30 text-red-600 dark:text-red-400">
            <XCircle className="size-3" /> failed
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3" /> {run.status || "success"}
          </Badge>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Stat icon={Clock} label="Duration" value={fmtDuration(run.duration_ms)} />
        <Stat icon={Zap} label="Cost" value={fmtCost(run.total_cost_usd)} />
        <Stat icon={Cpu} label="Input tokens" value={fmtTokens(run.input_tokens)} />
        <Stat icon={Cpu} label="Output tokens" value={fmtTokens(run.output_tokens)} />
        <Stat icon={TrendingIcon} label="Cache read" value={fmtTokens(run.cache_read_input_tokens)} tone="good" />
        <Stat icon={Wrench} label="Tool calls" value={run.tool_call_count.toString()} />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs text-muted-foreground">
        {run.model_id && <span className="px-2 py-1 rounded bg-muted">model: {run.model_id}</span>}
        {run.was_resume && <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">resumed session</span>}
        {run.first_token_ms != null && <span className="px-2 py-1 rounded bg-muted">TTFB: {fmtDuration(run.first_token_ms)}</span>}
        {run.routed_toolkits && run.routed_toolkits.length > 0 && (
          <span className="px-2 py-1 rounded bg-muted">toolkits: {run.routed_toolkits.join(", ")}</span>
        )}
        {run.job_id && <span className="px-2 py-1 rounded bg-muted font-mono">{run.job_id.slice(0, 8)}</span>}
        {run.conversation_id && <span className="px-2 py-1 rounded bg-muted">conv #{run.conversation_id}</span>}
      </div>

      {/* Error banner */}
      {isFailed && run.error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 text-red-500 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-700 dark:text-red-400">Error</div>
              <div className="text-xs text-red-600 dark:text-red-300 font-mono mt-1 whitespace-pre-wrap">{run.error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-4">
        {([
          ["overview", "Timeline"],
          ["spans", `Spans (${run.spans.length})`],
          ["prompt", "Prompt"],
          ["response", "Response"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Waterfall spans={run.spans} totalMs={totalMs} />}

      {tab === "spans" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Span</th>
                <th className="text-right px-3 py-2 font-medium">Start</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
                <th className="text-left px-3 py-2 font-medium">Meta</th>
              </tr>
            </thead>
            <tbody>
              {run.spans.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">
                    <div className="flex items-center gap-2">
                      <div className={`size-2 rounded-full ${spanColor(s.name)}`} />
                      {s.parent_id && <span className="text-muted-foreground">↳</span>}
                      {spanLabel(s.name)}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtDuration(s.start_ms)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtDuration(s.duration_ms)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground font-mono text-[10px] max-w-md truncate">
                    {Object.keys(s.meta || {}).length > 0 ? JSON.stringify(s.meta) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "prompt" && (
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <FileText className="size-3" />
            Prompt sent to model (first 500 chars)
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">{run.prompt || "—"}</pre>
        </div>
      )}

      {tab === "response" && (
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <FileText className="size-3" />
            Agent response (first 2000 chars)
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">{run.response || "—"}</pre>
        </div>
      )}
    </AppLayout>
  )
}

function Waterfall({ spans, totalMs }: { spans: Span[]; totalMs: number }) {
  if (spans.length === 0 || totalMs === 0) {
    return <div className="text-sm text-muted-foreground italic py-10 text-center">No span data (older run)</div>
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex justify-between">
        <span>Waterfall — {spans.length} spans</span>
        <span>{fmtDuration(totalMs)} total</span>
      </div>
      <div className="divide-y divide-border/50">
        {spans.map((s) => {
          const startPct = Math.min(100, (s.start_ms / totalMs) * 100)
          const widthPct = s.duration_ms != null ? Math.max(0.3, (s.duration_ms / totalMs) * 100) : 0.3
          return (
            <div key={s.id} className="px-3 py-1.5 hover:bg-muted/30 group">
              <div className="flex items-center gap-2 text-xs">
                <div className="w-56 truncate font-mono flex items-center gap-2">
                  {s.parent_id && <span className="text-muted-foreground">↳</span>}
                  {spanLabel(s.name)}
                </div>
                <div className="flex-1 relative h-5 bg-muted/40 rounded overflow-hidden">
                  <div
                    className={`absolute top-0 bottom-0 ${spanColor(s.name)} opacity-80 group-hover:opacity-100 transition-opacity`}
                    style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  />
                </div>
                <div className="w-20 text-right tabular-nums text-muted-foreground">
                  {fmtDuration(s.duration_ms)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrendingIcon({ className }: { className?: string }) {
  // Custom "cache" icon — down-right arrow to indicate savings
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  )
}

function Stat({
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
      <div className={`text-base font-semibold tabular-nums ${toneClasses}`}>{value}</div>
    </div>
  )
}
