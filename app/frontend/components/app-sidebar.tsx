import { Link } from "@inertiajs/react"
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
} from "lucide-react"

import AppLogo from "@/components/app-logo"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
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
import type { NavItem } from "@/types"

const workNavItems: NavItem[] = [
  { title: "Dashboard", href: dashboardPath(), icon: LayoutGrid },
  { title: "Agents", href: agentsPath(), icon: Bot },
  { title: "Tasks", href: tasksPath(), icon: CheckSquare },
  { title: "Integrations", href: integrationsPath(), icon: Plug },
  { title: "Templates", href: "/agent_templates", icon: BookMarked },
  { title: "Reports", href: "/reports", icon: TrendingUp },
]

const controlNavItems: NavItem[] = [
  { title: "Approvals", href: pendingApprovalsPath(), icon: ShieldCheck },
  { title: "Ops", href: "/ops/runs", icon: Activity },
  { title: "Audit Log", href: auditLogsPath(), icon: ScrollText },
  { title: "Team",      href: "/invitations",  icon: Users },
  { title: "Credentials", href: "/settings/credentials", icon: KeyRound },
  { title: "Settings",  href: settingsPath(), icon: Settings },
]

export function AppSidebar() {
  const { theme, setTheme } = useTheme()
  const { toggleSidebar, open } = useSidebar()

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

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <NavMain items={workNavItems} />
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Control panel</SidebarGroupLabel>
          <NavSecondary items={controlNavItems} />
        </SidebarGroup>
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
              {open ? (
                <PanelLeftClose className="size-3.5" />
              ) : (
                <PanelLeft className="size-3.5" />
              )}
            </button>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
