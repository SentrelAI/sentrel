import { Head, Link } from "@inertiajs/react"
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckSquare,
  Clock,
  Plus,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"

import { GlowCard, Overline, StatTile, StatusDot } from "@/components/brand"
import { Button } from "@/components/ui/button"
import AppLayout from "@/layouts/app-layout"
import { agentPath, dashboardPath, newAgentPath, pendingApprovalsPath, tasksPath } from "@/routes"
import type { Agent, DashboardStats } from "@/types"

interface Props {
  agents: Agent[]
  stats: DashboardStats
}

const STATUS_MAP: Record<string, { dot: "online" | "working" | "idle" | "error" | "offline"; label: string }> = {
  running: { dot: "working", label: "Running" },
  pending: { dot: "idle", label: "Pending" },
  paused: { dot: "offline", label: "Paused" },
  stopped: { dot: "error", label: "Stopped" },
  starting: { dot: "working", label: "Starting" },
}

export default function DashboardIndex({ agents, stats }: Props) {
  const runningCount = agents.filter((a) => a.status === "running").length

  return (
    <AppLayout
      fullBleed
      crumbs={[{ label: "Workspace", href: dashboardPath() }, { label: "Dashboard" }]}
      topBarActions={
        <Button asChild size="sm" className="gap-1.5 h-8">
          <Link href={newAgentPath()}>
            <Plus className="size-3.5" />
            New agent
          </Link>
        </Button>
      }
    >
      <Head title="Dashboard" />

      {/* ======= Masthead ======= */}
      <section className="relative overflow-hidden border-b bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(60% 40% at 100% 0%, var(--indigo-glow) 0%, transparent 55%), radial-gradient(30% 30% at 0% 0%, var(--cyan-glow) 0%, transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade opacity-50"
        />

        <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10 md:gap-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-3">
              <Overline accent={runningCount > 0} dot>
                {runningCount > 0
                  ? `${runningCount} agent${runningCount > 1 ? "s" : ""} working`
                  : "All quiet"}
              </Overline>
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-foreground md:text-5xl">
                Good to see you.
              </h1>
              <p className="max-w-xl text-[15px] text-muted-foreground">
                A snapshot of your AI workforce — what's running, what needs you,
                and what landed since you last checked.
              </p>
            </div>

            {stats.pending_approvals > 0 && (
              <Button asChild variant="outline" size="sm" className="hidden h-9 gap-1.5 md:inline-flex">
                <Link href={pendingApprovalsPath()}>
                  <ShieldCheck className="size-3.5" />
                  Review {stats.pending_approvals} approval{stats.pending_approvals === 1 ? "" : "s"}
                </Link>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Total agents"
              value={stats.total_agents}
              icon={<Bot className="size-4" />}
            />
            <StatTile
              label="Running"
              value={stats.running_agents}
              icon={<Activity className="size-4" />}
              accent={stats.running_agents > 0}
            />
            <StatTile
              label="Approvals"
              value={stats.pending_approvals}
              icon={<ShieldCheck className="size-4" />}
              delta={
                stats.pending_approvals > 0
                  ? { value: "awaiting you", direction: "flat" }
                  : undefined
              }
            />
            <StatTile
              label="Active tasks"
              value={stats.tasks_in_progress}
              icon={<CheckSquare className="size-4" />}
            />
          </div>
        </div>
      </section>

      {/* ======= Body ======= */}
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 sm:py-10 md:gap-10 lg:grid-cols-12">
        {/* Agents */}
        <div className="lg:col-span-8">
          <div className="mb-5 flex items-end justify-between">
            <div className="space-y-1">
              <Overline>Your roster</Overline>
              <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                Agents on your team
              </h2>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 h-8">
              <Link href="/agents">
                All agents <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          {agents.length === 0 ? (
            <EmptyRoster />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <aside className="lg:col-span-4 space-y-6">
          <QuickActions />
          <SystemHealth
            runningCount={runningCount}
            approvalsCount={stats.pending_approvals}
            tasksCount={stats.tasks_in_progress}
          />
        </aside>
      </div>
    </AppLayout>
  )
}

/* ------------------------------------------------------------
   Agent card
   ------------------------------------------------------------ */
function AgentCard({ agent }: { agent: Agent }) {
  const st = STATUS_MAP[agent.status] ?? STATUS_MAP.stopped
  const preview = agent.instructions_md ?? agent.identity_md ?? null

  return (
    <Link href={agentPath(agent.id)} className="group block">
      <GlowCard glow={agent.status === "running" ? "soft" : "none"} tint="cyan" className="h-full p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="flex size-10 items-center justify-center rounded-md border font-display text-sm font-semibold text-foreground"
                style={{
                  borderColor: "var(--cyan-border)",
                  background: "var(--cyan-surface)",
                }}
              >
                {agent.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5">
                <StatusDot status={st.dot} pulse={agent.status === "running"} ring />
              </span>
            </div>
            <div>
              <h3 className="font-display text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground">
                {agent.name}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          <span className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {st.label}
          </span>
        </div>

        <div className="mt-4 min-h-[56px]">
          {preview ? (
            <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground/90">
              {preview}
            </p>
          ) : (
            <p className="text-[13px] italic text-muted-foreground/50">
              No instructions set — add some to start the agent.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="font-mono text-[10px] text-muted-foreground">
            {agent.ai_config?.model_id ?? "—"}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground group-hover:text-foreground">
            Open <ArrowUpRight className="size-3" />
          </span>
        </div>
      </GlowCard>
    </Link>
  )
}

/* ------------------------------------------------------------
   Empty roster
   ------------------------------------------------------------ */
function EmptyRoster() {
  return (
    <GlowCard glow="soft" tint="indigo" className="p-10 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-dashed">
        <Bot className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-5 font-display text-lg font-semibold text-foreground">
        No agents yet.
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Hire your first AI employee — pick a role, connect tools, set policy.
        Ready in 90 seconds.
      </p>
      <Button asChild className="mt-6 gap-1.5">
        <Link href={newAgentPath()}>
          <Plus className="size-3.5" />
          Hire an agent
        </Link>
      </Button>
    </GlowCard>
  )
}

/* ------------------------------------------------------------
   Quick actions
   ------------------------------------------------------------ */
function QuickActions() {
  const actions = [
    { label: "Hire new agent", href: newAgentPath(), icon: Plus, accent: true },
    { label: "Review approvals", href: pendingApprovalsPath(), icon: ShieldCheck },
    { label: "Open tasks", href: tasksPath(), icon: CheckSquare },
    { label: "Live run feed", href: "/ops/runs", icon: Activity },
  ]

  return (
    <div>
      <Overline className="mb-3">Quick actions</Overline>
      <div className="divide-y rounded-lg border bg-card">
        {actions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="group flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--muted)]"
          >
            <span className="flex items-center gap-2.5 text-[13px] font-medium text-foreground">
              <a.icon
                className={`size-3.5 ${a.accent ? "text-[var(--color-indigo)]" : "text-muted-foreground"}`}
              />
              {a.label}
            </span>
            <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------
   System health
   ------------------------------------------------------------ */
interface SystemHealthProps {
  runningCount: number
  approvalsCount: number
  tasksCount: number
}

function SystemHealth({ runningCount, approvalsCount, tasksCount }: SystemHealthProps) {
  const rows = [
    {
      label: "Agents online",
      value: runningCount,
      icon: Activity,
      status: runningCount > 0 ? ("online" as const) : ("offline" as const),
    },
    {
      label: "Approvals waiting",
      value: approvalsCount,
      icon: ShieldCheck,
      status: approvalsCount > 0 ? ("idle" as const) : ("online" as const),
    },
    {
      label: "Tasks in flight",
      value: tasksCount,
      icon: Zap,
      status: "online" as const,
    },
    {
      label: "LLM providers",
      value: "OK",
      icon: Sparkles,
      status: "online" as const,
    },
  ]

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Overline>System</Overline>
        <span className="font-mono text-[10px] text-muted-foreground">
          <Clock className="mr-1 inline size-2.5" /> live
        </span>
      </div>
      <div className="divide-y rounded-lg border bg-card">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <span className="flex items-center gap-2.5 text-[13px] text-foreground">
              <row.icon className="size-3.5 text-muted-foreground" />
              {row.label}
            </span>
            <span className="flex items-center gap-2">
              <StatusDot status={row.status} />
              <span className="font-mono text-xs font-medium text-foreground">{row.value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
