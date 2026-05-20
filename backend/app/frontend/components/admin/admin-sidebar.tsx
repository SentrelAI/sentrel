import { Link, usePage } from "@inertiajs/react"
import {
  LayoutDashboard,
  FileText,
  Wrench,
  Bot,
  Users,
  Building2,
  Hammer,
  Sparkles,
  ArrowLeft,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
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
import { dashboardPath } from "@/routes"
import type { NavItem } from "@/types"

const adminPrimary: NavItem[] = [
  { title: "Dashboard",      href: "/admin/dashboard",     icon: LayoutDashboard },
  { title: "Templates",      href: "/admin/templates",     icon: FileText },
  { title: "Skills",         href: "/admin/skills",        icon: Wrench },
  { title: "Agents",         href: "/admin/agents",        icon: Bot },
  { title: "Users",          href: "/admin/users",         icon: Users },
  { title: "Organizations",  href: "/admin/organizations", icon: Building2 },
  { title: "Forge Runner",   href: "/admin/forge",         icon: Hammer },
]

export function AdminSidebar() {
  const { theme, setTheme } = useTheme()
  const { toggleSidebar, open } = useSidebar()
  const { props } = usePage<{ is_platform_admin?: boolean }>()
  const isPlatformAdmin = props.is_platform_admin === true

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/admin/dashboard" prefetch>
                <div className="flex items-center gap-2 px-1">
                  <div className="flex size-7 items-center justify-center rounded-md bg-purple-600 text-white">
                    <Sparkles className="size-3.5" />
                  </div>
                  <span className="text-sm font-semibold tracking-tight">Admin Panel</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="!pt-4">
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <NavMain items={adminPrimary} />
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Other</SidebarGroupLabel>
          <SidebarGroupContent>
            <Link
              href={dashboardPath()}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              prefetch
            >
              <ArrowLeft className="size-3.5" />
              <span>Back to workspace</span>
            </Link>
          </SidebarGroupContent>
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
              {open ? <PanelLeftClose className="size-3.5" /> : <PanelLeft className="size-3.5" />}
            </button>
          </SidebarGroupContent>
        </SidebarGroup>
        {isPlatformAdmin && <NavUser />}
      </SidebarFooter>
    </Sidebar>
  )
}
