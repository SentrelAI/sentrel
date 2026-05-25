import { Link, router } from "@inertiajs/react"
import { useEffect, useState } from "react"
import {
  ShieldCheck,
  Activity,
  DollarSign,
  Cable,
  Network,
  Wrench,
  ChevronDown,
  ChevronRight,
  Power,
  RotateCw,
  Pencil,
  PanelRightClose,
  PanelRight,
} from "lucide-react"
import type { Agent } from "@/types"

// ── Types ────────────────────────────────────────────────────────────

interface PendingApproval {
  id: number
  summary: string | null
  payload_type: string | null
  risk_tier: string | null
  created_at: string
}

interface ActivityEntry {
  id: number
  action: string
  tool_name: string | null
  status: string | null
  created_at: string
  duration_ms: number | null
}

interface AgentLink {
  id: string
  name: string
  role?: string
  status?: string
}

interface SkillRef {
  slug: string
  name: string
}

interface SpendPayload {
  daily_total_usd: number
  monthly_total_usd: number
  daily_cap_usd: number | null
  monthly_cap_usd: number | null
}

export interface RailPayload {
  pending_approvals: PendingApproval[]
  recent_activity: ActivityEntry[]
  channels: string[]
  manager: AgentLink | null
  reports: AgentLink[]
  skills: SkillRef[]
}

interface Props {
  agent: Agent
  rail: RailPayload
  spend: SpendPayload | null
}

// ── Card collapse-state helper (localStorage-backed) ────────────────

function useCardOpen(key: string, def: boolean = true) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return def
    const raw = window.localStorage.getItem(`rail.${key}`)
    return raw == null ? def : raw === "1"
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(`rail.${key}`, open ? "1" : "0")
  }, [key, open])
  return [open, setOpen] as const
}

function useRailOpen() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    const raw = window.localStorage.getItem("rail.open")
    return raw == null ? true : raw === "1"
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("rail.open", open ? "1" : "0")
  }, [open])
  return [open, setOpen] as const
}

// ── Main component ──────────────────────────────────────────────────

export function AgentRail({ agent, rail, spend }: Props) {
  const [open, setOpen] = useRailOpen()

  if (!open) {
    return (
      <div className="hidden lg:flex w-10 shrink-0 border-l border-border flex-col items-center py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Show rail"
        >
          <PanelRight className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <aside className="hidden lg:flex w-80 shrink-0 flex-col border-l border-border overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Context</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Hide rail"
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-1.5 p-2">
        <ApprovalsCard agent={agent} approvals={rail.pending_approvals} />
        <StatusCard agent={agent} />
        <ActivityCard activity={rail.recent_activity} />
        <SpendCard spend={spend} />
        <ChannelsCard agentId={agent.id} channels={rail.channels} />
        <HierarchyCard agentId={agent.id} manager={rail.manager} reports={rail.reports} />
        <SkillsCard agentId={agent.id} skills={rail.skills} />
      </div>
    </aside>
  )
}

// ── Card chrome ─────────────────────────────────────────────────────

function RailCard({
  storageKey,
  title,
  icon: Icon,
  badge,
  children,
  defaultOpen = true,
}: {
  storageKey: string
  title: string
  icon: typeof ShieldCheck
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useCardOpen(storageKey, defaultOpen)
  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {open ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        {badge}
      </button>
      {open && <div className="border-t border-border px-2.5 py-2">{children}</div>}
    </div>
  )
}

// ── Individual cards ────────────────────────────────────────────────

function ApprovalsCard({ agent, approvals }: { agent: Agent; approvals: PendingApproval[] }) {
  const count = approvals.length
  return (
    <RailCard
      storageKey="approvals"
      title="Approvals"
      icon={ShieldCheck}
      badge={
        count > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {count}
          </span>
        ) : null
      }
    >
      {approvals.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nothing waiting on you.</p>
      ) : (
        <ul className="space-y-1.5">
          {approvals.slice(0, 5).map((a) => (
            <li key={a.id} className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
              <p className="text-[11px] text-foreground line-clamp-2">{a.summary || a.payload_type || "Approval requested"}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {a.payload_type || "generic"} · {timeAgo(a.created_at)}
              </p>
            </li>
          ))}
          {approvals.length > 5 && (
            <li>
              <Link href={`/agents/${agent.id}?tab=approvals`} className="text-[11px] text-foreground/80 hover:underline">
                + {approvals.length - 5} more
              </Link>
            </li>
          )}
          <li>
            <Link href="/approvals" className="text-[11px] text-foreground/80 hover:underline">
              Open all approvals →
            </Link>
          </li>
        </ul>
      )}
    </RailCard>
  )
}

function StatusCard({ agent }: { agent: Agent }) {
  const status = agent.status || "unknown"
  const tone =
    status === "running" ? "bg-emerald-500" :
    status === "pending" || status === "starting" ? "bg-amber-500" :
    status === "paused" ? "bg-zinc-500" :
    status === "stopped" || status === "error" ? "bg-red-500" :
    "bg-zinc-500"

  function restart() {
    if (!confirm(`Restart ${agent.name}? In-flight tool calls will be interrupted.`)) return
    router.post(`/agents/${agent.id}/ops/restart`, {}, { preserveScroll: true })
  }
  function reload() {
    router.post(`/agents/${agent.id}/ops/reload`, {}, { preserveScroll: true })
  }

  return (
    <RailCard
      storageKey="status"
      title="Status"
      icon={Power}
      badge={
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <span className={`size-1.5 rounded-full ${tone}`} /> {status}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={restart} className="rounded border border-border bg-background px-2 py-1.5 text-[11px] hover:bg-muted inline-flex items-center justify-center gap-1">
          <RotateCw className="size-3" /> Restart
        </button>
        <button onClick={reload} className="rounded border border-border bg-background px-2 py-1.5 text-[11px] hover:bg-muted inline-flex items-center justify-center gap-1">
          <RotateCw className="size-3" /> Reload
        </button>
        <Link href={`/agents/${agent.id}/edit`} className="col-span-2 rounded border border-border bg-background px-2 py-1.5 text-[11px] text-center hover:bg-muted inline-flex items-center justify-center gap-1">
          <Pencil className="size-3" /> Edit
        </Link>
      </div>
    </RailCard>
  )
}

function ActivityCard({ activity }: { activity: ActivityEntry[] }) {
  return (
    <RailCard storageKey="activity" title="Activity" icon={Activity}>
      {activity.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No activity in the last 24h.</p>
      ) : (
        <ul className="space-y-1">
          {activity.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 text-[10.5px]">
              <span className={`size-1.5 shrink-0 rounded-full ${
                a.status === "success" ? "bg-emerald-500" :
                a.status === "failed" || a.status === "error" ? "bg-red-500" :
                "bg-zinc-400"
              }`} />
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {a.tool_name || a.action}
              </span>
              <span className="shrink-0 text-muted-foreground/70">{timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  )
}

function SpendCard({ spend }: { spend: SpendPayload | null }) {
  if (!spend) return null
  const dailyCap = spend.daily_cap_usd
  const dailyPct = dailyCap && dailyCap > 0 ? Math.min(100, Math.round((spend.daily_total_usd / dailyCap) * 100)) : null
  return (
    <RailCard storageKey="spend" title="Spend (today)" icon={DollarSign}>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold tabular-nums">${spend.daily_total_usd.toFixed(2)}</span>
          <span className="text-[10px] text-muted-foreground">
            {dailyCap ? `of $${dailyCap.toFixed(2)} cap` : "no cap"}
          </span>
        </div>
        {dailyPct !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${dailyPct >= 90 ? "bg-red-500" : dailyPct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${dailyPct}%` }}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Month: ${spend.monthly_total_usd.toFixed(2)}
          {spend.monthly_cap_usd && ` / $${spend.monthly_cap_usd.toFixed(2)}`}
        </p>
      </div>
    </RailCard>
  )
}

function ChannelsCard({ agentId, channels }: { agentId: string | number; channels: string[] }) {
  return (
    <RailCard
      storageKey="channels"
      title="Channels"
      icon={Cable}
      badge={<span className="text-[10px] text-muted-foreground">{channels.length}</span>}
    >
      {channels.length === 0 ? (
        <Link href={`/agents/${agentId}/channel_configs`} className="text-[11px] text-foreground/80 hover:underline">
          + Connect a channel
        </Link>
      ) : (
        <div className="flex flex-wrap gap-1">
          {channels.map((ch) => (
            <span key={ch} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] capitalize">
              {ch}
            </span>
          ))}
          <Link
            href={`/agents/${agentId}/channel_configs`}
            className="rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            + Add
          </Link>
        </div>
      )}
    </RailCard>
  )
}

function HierarchyCard({ agentId, manager, reports }: { agentId: string | number; manager: AgentLink | null; reports: AgentLink[] }) {
  if (!manager && reports.length === 0) {
    return (
      <RailCard storageKey="hierarchy" title="Hierarchy" icon={Network} defaultOpen={false}>
        <p className="text-[11px] text-muted-foreground">No manager or reports yet. Set up at <Link href={`/agents/${agentId}/edit`} className="underline">Edit</Link>.</p>
      </RailCard>
    )
  }
  return (
    <RailCard storageKey="hierarchy" title="Hierarchy" icon={Network}>
      {manager && (
        <div className="mb-2">
          <p className="text-[10px] uppercase text-muted-foreground">Reports to</p>
          <Link href={`/agents/${manager.id}`} className="mt-0.5 inline-block text-[11px] font-medium hover:underline">
            {manager.name}
            {manager.role && <span className="text-muted-foreground"> · {manager.role}</span>}
          </Link>
        </div>
      )}
      {reports.length > 0 && (
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">Direct reports ({reports.length})</p>
          <ul className="mt-0.5 space-y-0.5">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/agents/${r.id}`} className="text-[11px] hover:underline">
                  {r.name}
                  {r.role && <span className="text-muted-foreground"> · {r.role}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RailCard>
  )
}

function SkillsCard({ agentId, skills }: { agentId: string | number; skills: SkillRef[] }) {
  return (
    <RailCard
      storageKey="skills"
      title="Skills"
      icon={Wrench}
      badge={<span className="text-[10px] text-muted-foreground">{skills.length}</span>}
      defaultOpen={false}
    >
      {skills.length === 0 ? (
        <Link href={`/agents/${agentId}/edit?tab=behavior`} className="text-[11px] text-foreground/80 hover:underline">
          + Install a skill
        </Link>
      ) : (
        <div className="flex flex-wrap gap-1">
          {skills.map((s) => (
            <span key={s.slug} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]" title={s.slug}>
              {s.name}
            </span>
          ))}
        </div>
      )}
    </RailCard>
  )
}

// ── helpers ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = (Date.now() - then) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
