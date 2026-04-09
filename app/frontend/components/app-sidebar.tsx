import { Link } from "@inertiajs/react"
import {
  LayoutGrid,
  Bot,
  CheckSquare,
  Plug,
  ShieldCheck,
  ScrollText,
  Settings,
  Plus,
  Sun,
  Moon,
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

const mainNavItems: NavItem[] = [
  { title: "Dashboard", href: authenticatedRootPath(), icon: LayoutGrid },
  { title: "Agents", href: agentsPath(), icon: Bot },
  { title: "Tasks", href: tasksPath(), icon: CheckSquare },
  { title: "Integrations", href: integrationsPath(), icon: Plug },
]

const secondaryNavItems: NavItem[] = [
  { title: "Approvals", href: pendingApprovalsPath(), icon: ShieldCheck },
  { title: "Audit Log", href: auditLogsPath(), icon: ScrollText },
  { title: "Settings", href: settingsPath(), icon: Settings },
]

export function AppSidebar() {
  const { theme, setTheme } = useTheme()

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

        <SidebarGroup className="p-0 pt-2">
          <SidebarGroupContent>
            <Button asChild variant="secondary" className="w-full justify-start gap-2 h-9">
              <Link href={newAgentPath()}>
                <Plus className="size-4" />
                <span>New Agent</span>
              </Link>
            </Button>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={mainNavItems} />
        <NavSecondary items={secondaryNavItems} className="mt-auto" />
      </SidebarContent>

      <SidebarFooter>
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
