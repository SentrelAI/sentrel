import { Link } from "@inertiajs/react"
import type { ReactNode } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export type Crumb = {
  label: string
  href?: string
}

interface TopBarProps {
  crumbs?: Crumb[]
  /** Right-aligned actions (buttons, filters, etc.) */
  actions?: ReactNode
  /** Optional slot rendered below the crumb line (tabs, filters) */
  children?: ReactNode
}

export function TopBar({ crumbs, actions, children }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex shrink-0 flex-col border-b bg-background/90 backdrop-blur-md">
      <div className="flex h-12 items-center gap-3 px-5">
        <SidebarTrigger className="-ml-1.5 size-7" />
        <Separator orientation="vertical" className="h-4 opacity-60" />

        {crumbs && crumbs.length > 0 ? (
          <Breadcrumb>
            <BreadcrumbList className="gap-1.5">
              {crumbs.map((crumb, i) => {
                const isLast = i === crumbs.length - 1
                return (
                  <div key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && (
                      <BreadcrumbSeparator className="font-mono text-muted-foreground/40">
                        /
                      </BreadcrumbSeparator>
                    )}
                    <BreadcrumbItem>
                      {isLast || !crumb.href ? (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link href={crumb.href}>{crumb.label}</Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </div>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}

        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>

      {children && <div className="px-5">{children}</div>}
    </header>
  )
}
