import { Link, usePage } from "@inertiajs/react"
import { LayoutDashboard, FileText, Wrench, Bot, Users, Building2, Hammer } from "lucide-react"

const items = [
  { label: "Dashboard",     href: "/admin/dashboard",     icon: LayoutDashboard },
  { label: "Templates",     href: "/admin/templates",     icon: FileText },
  { label: "Skills",        href: "/admin/skills",        icon: Wrench },
  { label: "Agents",        href: "/admin/agents",        icon: Bot },
  { label: "Users",         href: "/admin/users",         icon: Users },
  { label: "Orgs",          href: "/admin/organizations", icon: Building2 },
  { label: "Forge Runner",  href: "/admin/forge",         icon: Hammer },
]

export default function AdminNav() {
  const { url } = usePage()
  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl gap-1 px-4 py-2 overflow-x-auto">
        {items.map(({ label, href, icon: Icon }) => {
          const active = url.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
