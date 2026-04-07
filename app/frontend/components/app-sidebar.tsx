import { Link } from "@inertiajs/react"
import {
  LayoutGrid,
  Bot,
  CheckSquare,
  Plug,
  ShieldCheck,
  ScrollText,
} from "lucide-react"

import AppLogo from "@/components/app-logo"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  authenticatedRootPath,
  agentsPath,
  tasksPath,
  integrationsPath,
  pendingApprovalsPath,
  auditLogsPath,
} from "@/routes"
import type { NavItem } from "@/types"

const mainNavItems: NavItem[] = [
  { title: "Dashboard", href: authenticatedRootPath(), icon: LayoutGrid },
  { title: "Agents", href: agentsPath(), icon: Bot },
  { title: "Tasks", href: tasksPath(), icon: CheckSquare },
  { title: "Integrations", href: integrationsPath(), icon: Plug },
  { title: "Approvals", href: pendingApprovalsPath(), icon: ShieldCheck },
  { title: "Audit Log", href: auditLogsPath(), icon: ScrollText },
]

export function AppSidebar() {
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
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={mainNavItems} />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
