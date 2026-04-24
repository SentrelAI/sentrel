import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import {
  Wrench,
  RefreshCw,
  RotateCcw,
  Rocket,
  Trash2,
  FileText,
  Loader2,
  AlertTriangle,
  Zap,
  Clock,
} from "lucide-react"

interface AgentOpsMenuProps {
  agentId: number
}

type LogEntry = {
  timestamp?: string
  level?: string
  message: string
  instance?: string
}

type OpKey = "reload" | "restart" | "redeploy" | "reprovision"

interface OpSpec {
  key: OpKey
  label: string
  title: string
  icon: typeof RefreshCw
  // User-facing explanation — shown in the confirmation modal.
  summary: string
  details: string[]
  impact: { label: string; tone: "ok" | "warn" | "danger" }
  confirmLabel: string
  destructive?: boolean
}

const OPS: OpSpec[] = [
  {
    key: "reload",
    label: "Reload config",
    title: "Reload configuration",
    icon: RefreshCw,
    summary:
      "Tells the engine to re-read the agent from the database and rebuild its live state — no process restart.",
    details: [
      "Picks up changes to identity, personality, instructions, and memory.",
      "Re-syncs installed skills so new ones are available immediately.",
      "Restarts Telegram / WhatsApp pollers with any new tokens.",
      "Zero downtime. Completes in under a second.",
    ],
    impact: { label: "No downtime", tone: "ok" },
    confirmLabel: "Reload now",
  },
  {
    key: "restart",
    label: "Restart machine",
    title: "Restart the agent machine",
    icon: RotateCcw,
    summary:
      "Restarts the Fly Machine running this agent. Clears in-memory state but keeps the persistent /data volume.",
    details: [
      "Use when the engine behaves oddly, leaks memory, or you want a clean process.",
      "Session transcripts, workspace files, and RAG index are preserved.",
      "Open WebSocket listeners drop and reconnect automatically.",
      "Takes roughly 10–20 seconds while the container boots again.",
    ],
    impact: { label: "~10–20s downtime", tone: "warn" },
    confirmLabel: "Restart now",
  },
  {
    key: "redeploy",
    label: "Redeploy latest image",
    title: "Redeploy to latest engine image",
    icon: Rocket,
    summary:
      "Pulls the newest ghcr.io/parsedev/alchemy-engine:latest image from CI and rolls the Machine onto it.",
    details: [
      "Use right after pushing engine code changes that have been built by CI.",
      "The current /data volume is reattached to the new container.",
      "Environment variables are re-applied from the provisioner config.",
      "Takes roughly 20–40 seconds depending on image size.",
    ],
    impact: { label: "~20–40s downtime", tone: "warn" },
    confirmLabel: "Redeploy latest",
  },
  {
    key: "reprovision",
    label: "Reprovision (destroy + rebuild)",
    title: "Reprovision agent from scratch",
    icon: Trash2,
    summary:
      "Destroys the Fly app, its Machine, AND its 10 GB persistent volume, then creates everything fresh via the provisioner.",
    details: [
      "⚠️ Workspace files, RAG index, and Claude SDK session transcripts are permanently lost.",
      "The Postgres conversation history survives (it lives in RDS, not the volume).",
      "Use only when /data is corrupt or you need a guaranteed clean slate.",
      "Takes roughly 60 seconds: destroy → create app + volume → boot engine → report ready.",
    ],
    impact: { label: "~60s downtime + DATA LOSS", tone: "danger" },
    confirmLabel: "Yes, destroy and rebuild",
    destructive: true,
  },
]

async function opsPost(agentId: number, action: string) {
  const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  const res = await fetch(`/agents/${agentId}/ops/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: "{}",
  })
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }))
  return data as { ok: boolean; message: string }
}

export function AgentOpsMenu({ agentId }: AgentOpsMenuProps) {
  const [busy, setBusy] = useState<OpKey | null>(null)
  const [pending, setPending] = useState<OpSpec | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runOp = async (spec: OpSpec) => {
    setPending(null)
    setBusy(spec.key)
    try {
      const result = await opsPost(agentId, spec.key)
      if (result.ok) toast.success(`${spec.label}: ${result.message}`)
      else toast.error(`${spec.label} failed: ${result.message}`)
    } catch (err) {
      toast.error(`${spec.label} failed: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const fetchLogs = async () => {
    setLogsLoading(true)
    try {
      const res = await fetch(`/agents/${agentId}/ops/logs?lines=300`)
      const data = await res.json()
      setLogs(Array.isArray(data.logs) ? data.logs : [])
    } catch (err) {
      toast.error(`Logs failed: ${(err as Error).message}`)
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    if (!logsOpen) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    fetchLogs()
    pollRef.current = setInterval(fetchLogs, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logsOpen, agentId])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
            Ops
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Machine operations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OPS.map((op) => {
            const Icon = op.icon
            return (
              <DropdownMenuItem
                key={op.key}
                disabled={busy !== null}
                onSelect={(e) => {
                  e.preventDefault()
                  setPending(op)
                }}
                className={
                  op.destructive
                    ? "text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20"
                    : "focus:bg-muted focus:text-foreground"
                }
              >
                <Icon className="size-4" />
                <span>{op.label}</span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setLogsOpen(true)}
            className="focus:bg-muted focus:text-foreground"
          >
            <FileText className="size-4" />
            <span>View logs</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Confirmation modal for every non-log action ── */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-lg">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <pending.icon className="size-5" />
                  {pending.title}
                </DialogTitle>
                <DialogDescription className="pt-2">{pending.summary}</DialogDescription>
              </DialogHeader>

              <ul className="space-y-2 text-sm">
                {pending.details.map((d, i) => (
                  <li key={i} className="text-muted-foreground flex gap-2">
                    <span className="text-foreground">•</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>

              <div
                className={
                  "mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm " +
                  (pending.impact.tone === "ok"
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                    : pending.impact.tone === "warn"
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                      : "border-destructive/40 bg-destructive/5 text-destructive")
                }
              >
                {pending.impact.tone === "ok" ? (
                  <Zap className="size-4" />
                ) : pending.impact.tone === "warn" ? (
                  <Clock className="size-4" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
                <span className="font-medium">Impact:</span>
                <span>{pending.impact.label}</span>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button
                  variant={pending.destructive ? "destructive" : "default"}
                  onClick={() => runOp(pending)}
                  disabled={busy !== null}
                >
                  {busy === pending.key ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    pending.confirmLabel
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Live logs drawer (no modal — side sheet) ── */}
      <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
        <SheetContent side="right" className="w-full max-w-3xl sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="size-4" />
              Agent logs
              {logsLoading && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
              <span className="text-muted-foreground ml-auto text-xs">Polling every 4s</span>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 overflow-auto rounded-md border bg-black/90 p-3 font-mono text-xs leading-relaxed text-green-300">
            {logs.length === 0 && !logsLoading && (
              <div className="text-muted-foreground italic">No log lines yet.</div>
            )}
            {logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-words">
                <span className="text-muted-foreground">{l.timestamp?.slice(11, 19) ?? ""}</span>{" "}
                {l.level && <span className="text-amber-300">[{l.level}]</span>} {l.message}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
