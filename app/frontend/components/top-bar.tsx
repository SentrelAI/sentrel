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
  /** Inline meta rendered after crumbs (status chips, etc.) */
  meta?: ReactNode
  /** Optional slot rendered below the crumb line (tabs, filters) */
  children?: ReactNode
}

export function TopBar({ crumbs, actions, meta, children }: TopBarProps) {
  const lastCrumb = crumbs && crumbs.length > 0 ? crumbs[crumbs.length - 1] : null
  return (
    <header className="z-20 flex shrink-0 flex-col border-b bg-background">
      <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-5">
        <SidebarTrigger className="-ml-1 size-7 shrink-0 sm:-ml-1.5" />
        <Separator orientation="vertical" className="h-4 opacity-60" />

        {/* Mobile: show only the current crumb label. Desktop: full trail */}
        {lastCrumb && (
          <span className="min-w-0 truncate font-mono text-[12px] font-medium text-foreground sm:hidden">
            {lastCrumb.label}
          </span>
        )}

        {crumbs && crumbs.length > 0 && (
          <div className="hidden min-w-0 sm:block">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap gap-1.5">
                {crumbs.map((crumb, i) => {
                  const isLast = i === crumbs.length - 1
                  return (
                    <div
                      key={`${crumb.label}-${i}`}
                      className="flex min-w-0 items-center gap-1.5"
                    >
                      {i > 0 && (
                        <BreadcrumbSeparator className="font-mono text-muted-foreground/40">
                          /
                        </BreadcrumbSeparator>
                      )}
                      <BreadcrumbItem className="min-w-0">
                        {isLast || !crumb.href ? (
                          <BreadcrumbPage className="truncate">
                            {crumb.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={crumb.href} className="truncate">
                              {crumb.label}
                            </Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </div>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}

        {/* Meta chips — hidden on the tightest viewport */}
        {meta && <div className="hidden sm:contents">{meta}</div>}

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {actions}
        </div>
      </div>

      {children && <div className="overflow-x-auto px-3 sm:px-5">{children}</div>}
    </header>
  )
}
