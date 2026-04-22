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
  Plus,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
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
  authenticatedRootPath,
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
  { title: "Dashboard", href: authenticatedRootPath(), icon: LayoutGrid },
  { title: "Agents", href: agentsPath(), icon: Bot },
  { title: "Tasks", href: tasksPath(), icon: CheckSquare },
  { title: "Integrations", href: integrationsPath(), icon: Plug },
  { title: "Reports", href: "/reports", icon: TrendingUp },
]

const controlNavItems: NavItem[] = [
  { title: "Approvals", href: pendingApprovalsPath(), icon: ShieldCheck },
  { title: "Ops", href: "/ops/runs", icon: Activity },
  { title: "Audit Log", href: auditLogsPath(), icon: ScrollText },
  { title: "Settings", href: settingsPath(), icon: Settings },
]

export function AppSidebar() {
  const { theme, setTheme } = useTheme()
  const { toggleSidebar, open } = useSidebar()

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={authenticatedRootPath()} prefetch>
                <AppLogo />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarGroup className="p-0 pt-3">
          <SidebarGroupContent>
            <Button
              asChild
              variant="default"
              className="w-full justify-start gap-2 h-9 text-[13px]"
            >
              <Link href={newAgentPath()}>
                <Plus className="size-3.5" />
                <span>New agent</span>
                <kbd className="ml-auto font-mono text-[10px] opacity-70">⌘N</kbd>
              </Link>
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <NavMain items={workNavItems} />
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Control plane</SidebarGroupLabel>
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
