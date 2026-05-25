import { Link, usePage } from "@inertiajs/react"
import { useEffect, useState } from "react"
import {
  LayoutGrid,
  Bot,
  CheckSquare,
  Plug,
  TrendingUp,
  ShieldCheck,
  ScrollText,
  Activity,
  Settings,
  Users,
  Plus,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  KeyRound,
  BookMarked,
  Wrench,
  Shield,
  ChevronRight,
  Library,
  CornerDownRight,
} from "lucide-react"

import AppLogo from "@/components/app-logo"
import { NavUser } from "@/components/nav-user"
import { useTheme } from "@/hooks/use-theme"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  dashboardPath,
  agentsPath,
  tasksPath,
  integrationsPath,
  pendingApprovalsPath,
  auditLogsPath,
  settingsPath,
  newAgentPath,
} from "@/routes"

interface AgentNode {
  id: string
  name: string
  slug: string
  role: string
  status: string
  depth: number
  has_children: boolean
  pending_approvals: number
  active_conversations: number
}

interface SharedProps {
  [key: string]: unknown
  is_platform_admin?: boolean
  agents_tree?: AgentNode[] | null
}

// Persisted expand state. Each agent (by id) + each group remembers whether
// it's open between page navigations. Cleared on logout (localStorage scoped).
function useExpandState(storageKey: string, initialOpen: boolean = false) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return initialOpen
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? initialOpen : raw === "1"
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(storageKey, open ? "1" : "0")
  }, [storageKey, open])
  return [open, setOpen] as const
}

export function AppSidebar() {
  const { theme, setTheme } = useTheme()
  const { toggleSidebar, open } = useSidebar()
  const { props, url } = usePage<SharedProps>()
  const isPlatformAdmin = props.is_platform_admin === true
  const agents = props.agents_tree || []

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href={dashboardPath()} prefetch>
                <AppLogo />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="!pt-6 !pb-2">
          <SidebarGroupContent>
            <Link
              href={newAgentPath()}
              className="group relative flex h-9 w-full items-center gap-2 overflow-hidden rounded-md bg-[var(--color-indigo)] px-3 text-[13px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_8px_20px_-8px_var(--indigo-glow)] transition-all hover:-translate-y-0.5 hover:bg-[var(--color-indigo-600)] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_12px_28px_-8px_var(--indigo-glow)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
              />
              <Plus className="relative size-3.5" strokeWidth={2.5} />
              <span className="relative">New agent</span>
            </Link>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Agents tree — the main focus of the sidebar. Sub-agents nest under
            their manager with a connector glyph. Each leaf shows pending +
            inbox counts when non-zero. */}
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between pr-2">
            <span>Agents</span>
            <Link
              href={agentsPath()}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              title="View all agents"
            >
              All
            </Link>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {agents.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-muted-foreground">No agents yet. Hit + New agent.</p>
            ) : (
              <AgentTree nodes={agents} currentUrl={url} />
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Top-level operational items — the things users hit constantly. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarLink href={dashboardPath()} icon={LayoutGrid} label="Dashboard" current={url} />
            <SidebarLink href={tasksPath()}     icon={CheckSquare} label="Tasks"   current={url} />
            <SidebarLink href={pendingApprovalsPath()} icon={ShieldCheck} label="Approvals" current={url} />
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Library — templates / skills / integrations / reports. */}
        <CollapsibleNav storageKey="sidebar.library" label="Library" icon={Library} currentUrl={url}>
          <SidebarLink href={integrationsPath()} icon={Plug}        label="Integrations" current={url} indent />
          <SidebarLink href="/agent_templates"   icon={BookMarked}  label="Templates"    current={url} indent />
          <SidebarLink href="/skills"            icon={Wrench}      label="Skills"       current={url} indent />
          <SidebarLink href="/reports"           icon={TrendingUp}  label="Reports"      current={url} indent />
        </CollapsibleNav>

        {/* Settings + ops — everything that used to live in "Control panel".
            Collapsed by default; remembers expanded state per browser. */}
        <CollapsibleNav storageKey="sidebar.settings" label="Settings" icon={Settings} currentUrl={url} className="mt-auto">
          <SidebarLink href="/ops/runs"             icon={Activity}    label="Ops"         current={url} indent />
          <SidebarLink href={auditLogsPath()}       icon={ScrollText}  label="Audit Log"   current={url} indent />
          <SidebarLink href="/invitations"          icon={Users}       label="Team"        current={url} indent />
          <SidebarLink href="/settings/credentials" icon={KeyRound}    label="Credentials" current={url} indent />
          <SidebarLink href={settingsPath()}        icon={Settings}    label="Workspace"   current={url} indent />
          {isPlatformAdmin && (
            <SidebarLink href="/admin/dashboard"    icon={Shield}      label="Admin"       current={url} indent />
          )}
        </CollapsibleNav>
      </SidebarContent>

      <SidebarFooter>
        <SidebarGroup className="p-0">
          <SidebarGroupContent className="flex items-center gap-1 px-1">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button
              onClick={toggleSidebar}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              title={open ? "Collapse sidebar" : "Expand sidebar"}
            >
              {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeft className="size-3.5" />}
            </button>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}

// ── Agent tree ────────────────────────────────────────────────────────

const AGENT_EXPAND_PREFIX = "sidebar.agent."
const AGENT_EXPAND_SUFFIX = ".open"

function readAgentExpanded(id: string, def: boolean): boolean {
  if (typeof window === "undefined") return def
  const raw = window.localStorage.getItem(`${AGENT_EXPAND_PREFIX}${id}${AGENT_EXPAND_SUFFIX}`)
  return raw == null ? def : raw === "1"
}

function AgentTree({ nodes, currentUrl }: { nodes: AgentNode[]; currentUrl: string }) {
  // Build the parent chain per row so we can hide rows whose ancestor is
  // collapsed. The backend emits depth-walked order, so the parent of each
  // row is the most recent prior row with depth-1.
  const ancestorIds: string[][] = []
  const stack: AgentNode[] = []
  for (const n of nodes) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= n.depth) stack.pop()
    ancestorIds.push(stack.map((a) => a.id))
    stack.push(n)
  }

  // Track expanded state for every manager agent (anyone with has_children).
  // Default: open. Persists per browser via localStorage.
  const managerIds = nodes.filter((n) => n.has_children).map((n) => n.id)
  const [expandMap, setExpandMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const id of managerIds) init[id] = readAgentExpanded(id, true)
    return init
  })

  function toggle(id: string) {
    setExpandMap((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `${AGENT_EXPAND_PREFIX}${id}${AGENT_EXPAND_SUFFIX}`,
          next[id] ? "1" : "0",
        )
      }
      return next
    })
  }

  return (
    <div className="space-y-0.5">
      {nodes.map((node, idx) => {
        // Hidden when any ancestor is collapsed.
        const hidden = ancestorIds[idx].some((aid) => expandMap[aid] === false)
        if (hidden) return null
        return (
          <AgentRow
            key={node.id}
            node={node}
            currentUrl={currentUrl}
            expanded={expandMap[node.id] !== false}
            onToggle={() => toggle(node.id)}
          />
        )
      })}
    </div>
  )
}

function AgentRow({
  node,
  currentUrl,
  expanded,
  onToggle,
}: {
  node: AgentNode
  currentUrl: string
  expanded: boolean
  onToggle: () => void
}) {
  const href = `/agents/${node.id}`
  const active = currentUrl === href || currentUrl.startsWith(`${href}/`) || currentUrl.startsWith(`${href}?`)
  return (
    <div
      className={`group flex items-center gap-1 rounded-md transition-colors ${
        active ? "bg-sidebar-accent text-foreground" : "text-foreground/85 hover:bg-sidebar-accent/60"
      }`}
      style={{ paddingLeft: `${node.depth * 0.75 + 0.25}rem` }}
    >
      {node.has_children ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onToggle() }}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      ) : node.depth > 0 ? (
        <CornerDownRight className="size-3 shrink-0 text-muted-foreground/50" />
      ) : (
        <span className="inline-block size-3 shrink-0" />
      )}
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-[12.5px]" prefetch>
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
        {node.status === "running" && (
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" title="Running" />
        )}
        {node.pending_approvals > 0 && (
          <span
            className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold tabular-nums text-amber-600 dark:text-amber-400"
            title={`${node.pending_approvals} pending approval${node.pending_approvals === 1 ? "" : "s"}`}
          >
            {node.pending_approvals}
          </span>
        )}
      </Link>
    </div>
  )
}

// ── Collapsible group ───────────────────────────────────────────────

function CollapsibleNav({
  storageKey,
  label,
  icon: Icon,
  children,
  currentUrl,
  className,
}: {
  storageKey: string
  label: string
  icon: typeof LayoutGrid
  children: React.ReactNode
  currentUrl: string
  className?: string
}) {
  // Heuristic: if any descendant link matches the current URL, default open.
  const childUrls = collectChildHrefs(children)
  const childActive = childUrls.some((h) => currentUrl.startsWith(h))
  const [open, setOpen] = useExpandState(storageKey, childActive)

  return (
    <SidebarGroup className={className}>
      <SidebarGroupContent>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors ${
            childActive ? "text-foreground" : "text-foreground/85 hover:bg-sidebar-accent hover:text-foreground"
          }`}
        >
          <ChevronRight className={`size-3 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="flex-1">{label}</span>
        </button>
        {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function collectChildHrefs(children: React.ReactNode): string[] {
  const out: string[] = []
  // SidebarLink-only — duck-type by reading props.href off React children.
  // Doesn't recurse; we don't nest groups today.
  if (!children) return out
  const arr = Array.isArray(children) ? children : [ children ]
  for (const c of arr) {
    if (c && typeof c === "object" && "props" in c) {
      const href = (c as { props: { href?: string } }).props.href
      if (typeof href === "string") out.push(href)
    }
  }
  return out
}

// ── Flat link primitive ────────────────────────────────────────────

function SidebarLink({
  href,
  icon: Icon,
  label,
  current,
  indent = false,
}: {
  href: string
  icon: typeof LayoutGrid
  label: string
  current: string
  indent?: boolean
}) {
  const active = current === href || current.startsWith(`${href}/`) || current.startsWith(`${href}?`)
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors ${
        indent ? "ml-3.5" : ""
      } ${active ? "bg-sidebar-accent text-foreground" : "text-foreground/85 hover:bg-sidebar-accent/60"}`}
      prefetch
    >
      <Icon className={`size-3.5 ${active ? "text-foreground" : "text-muted-foreground"}`} />
      <span>{label}</span>
    </Link>
  )
}
