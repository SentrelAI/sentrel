import { useState, useEffect } from "react"
import { router } from "@inertiajs/react"
import AppLayout from "@/layouts/app-layout"
import AdminNav from "@/components/admin/admin-nav"

interface EnvSource {
  name: string
  required: boolean
  present: boolean
  last_four: string | null
  note: string
}

interface State {
  completed_briefs?: string[]
  failed_briefs?: string[]
  last_updated_at?: string
}

interface LastRun {
  status?: string
  started_at?: string
  finished_at?: string
  concurrency?: number
  prewarm_count?: number
  brief_count?: number
  summary?: {
    skills_prewarmed: number
    templates_total: number
    templates_ok: number
    templates_failed: number
    duration_s: number
    cost_estimate_usd: number
    usage: { input_tokens: number; output_tokens: number; calls: number }
    failures: Array<{ slug: string; error: string }>
  }
  error?: string
}

interface Props {
  env_sources: EnvSource[]
  state: State
  last_run: LastRun | null
  idea_bank_size: number
  defaults: { concurrency: number; prewarm_count: number; brief_count: number }
}

export default function AdminForge({ env_sources, state, last_run: initialLastRun, idea_bank_size, defaults }: Props) {
  const [concurrency, setConcurrency] = useState(defaults.concurrency)
  const [prewarmCount, setPrewarmCount] = useState(defaults.prewarm_count)
  const [briefCount, setBriefCount] = useState(defaults.brief_count)
  const [resume, setResume] = useState(false)
  const [lastRun, setLastRun] = useState(initialLastRun)

  const running = lastRun?.status === "running"

  // Poll while running.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      router.reload({ only: ["last_run", "state"], onSuccess: (page) => {
        const props = page.props as unknown as Props
        setLastRun(props.last_run)
      } })
    }, 3000)
    return () => clearInterval(id)
  }, [running])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    router.post("/admin/forge", {
      concurrency,
      prewarm_count: prewarmCount,
      brief_count: briefCount,
      resume,
    }, { preserveScroll: true })
  }

  function resetState() {
    if (!confirm("Clear resume state? Next run will start from scratch.")) return
    router.post("/admin/forge/reset", {}, { preserveScroll: true })
  }

  const completedCount = state.completed_briefs?.length || 0

  return (
    <AppLayout crumbs={[{ label: "Admin" }, { label: "Forge" }]}>
      <AdminNav />
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Forge Runner</h1>

        {/* Env sources */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Env sources</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {env_sources.map((s) => (
              <li key={s.name} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={s.present ? "text-green-600" : "text-red-600"}>{s.present ? "●" : "○"}</span>
                    <span className="font-mono">{s.name}</span>
                    {s.required && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] uppercase text-orange-700">required</span>}
                  </div>
                  <div className="ml-5 text-xs text-muted-foreground">{s.note}</div>
                </div>
                {s.present && s.last_four && <span className="font-mono text-xs text-muted-foreground">…{s.last_four}</span>}
              </li>
            ))}
          </ul>
        </section>

        {/* Run form */}
        <form onSubmit={submit} className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold">Run bootstrap</h2>
          <p className="text-xs text-muted-foreground">IdeaBank has {idea_bank_size} briefs total. Run a subset first for confidence, then a full run.</p>
          <div className="grid gap-3 md:grid-cols-4">
            <Input label="Concurrency" value={concurrency} setValue={setConcurrency} min={1} max={30} />
            <Input label="Pre-warm skills" value={prewarmCount} setValue={setPrewarmCount} min={0} max={100} />
            <Input label="Brief count" value={briefCount} setValue={setBriefCount} min={1} max={idea_bank_size} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
              Resume previous
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={running} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {running ? "Running…" : "Kick off"}
            </button>
            <button type="button" onClick={resetState} className="rounded border px-4 py-2 text-sm">
              Reset resume state
            </button>
          </div>
        </form>

        {/* State / resume info */}
        {completedCount > 0 && (
          <section className="rounded-lg border bg-card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Resume state</h2>
            <div>Completed: {completedCount}</div>
            <div>Failed: {state.failed_briefs?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Last updated: {state.last_updated_at || "—"}</div>
          </section>
        )}

        {/* Last run */}
        {lastRun && (
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Last run</h2>
              <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                lastRun.status === "running" ? "bg-blue-100 text-blue-700" :
                lastRun.status === "done"    ? "bg-green-100 text-green-700" :
                lastRun.status === "errored" ? "bg-red-100 text-red-700" :
                "bg-gray-100 text-gray-700"
              }`}>{lastRun.status}</span>
            </div>
            <div className="grid gap-2 text-xs">
              <div>Started: {lastRun.started_at || "—"}</div>
              {lastRun.finished_at && <div>Finished: {lastRun.finished_at}</div>}
              {lastRun.summary && (
                <>
                  <div>Skills pre-warmed: {lastRun.summary.skills_prewarmed}</div>
                  <div>Templates: {lastRun.summary.templates_ok}/{lastRun.summary.templates_total} ok ({lastRun.summary.duration_s}s)</div>
                  <div>Tokens: {lastRun.summary.usage.input_tokens.toLocaleString()} in / {lastRun.summary.usage.output_tokens.toLocaleString()} out ({lastRun.summary.usage.calls} calls)</div>
                  <div>Estimated cost: ${lastRun.summary.cost_estimate_usd}</div>
                </>
              )}
              {lastRun.error && <div className="text-red-600">Error: {lastRun.error}</div>}
            </div>
            {lastRun.summary?.failures && lastRun.summary.failures.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-red-600">{lastRun.summary.failures.length} failures</summary>
                <ul className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                  {lastRun.summary.failures.map((f, i) => (
                    <li key={i}>{f.slug}: {f.error}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  )
}

function Input({ label, value, setValue, min, max }: { label: string; value: number; setValue: (n: number) => void; min: number; max: number }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(Math.max(min, Math.min(max, Number(e.target.value))))}
        min={min}
        max={max}
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  )
}
