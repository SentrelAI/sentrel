import type { ReactNode } from "react"

import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { TopBar, type Crumb } from "@/components/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

interface AdminLayoutProps {
  children: ReactNode
  /** Crumb trail shown in the top bar */
  crumbs?: Crumb[]
  /** Right-aligned actions in the top bar (buttons, search, etc.) */
  topBarActions?: ReactNode
  /** Inline meta after crumbs (status pills, etc.) */
  topBarMeta?: ReactNode
  /** Content rendered below the crumb line in the top bar (tabs, filters) */
  topBarExtra?: ReactNode
  /** Escape hatch: fully custom top bar */
  header?: ReactNode
  /** Disable default main padding (useful for chat/full-bleed views) */
  fullBleed?: boolean
}

// Admin section layout — separate SidebarProvider so the admin sidebar's
// collapse state is independent of the main app's. Same prop shape as
// AppLayout for drop-in migration.
export default function AdminLayout({
  children,
  crumbs,
  topBarActions,
  topBarMeta,
  topBarExtra,
  header,
  fullBleed = false,
}: AdminLayoutProps) {
  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        {header ?? (
          <TopBar crumbs={crumbs} actions={topBarActions} meta={topBarMeta}>
            {topBarExtra}
          </TopBar>
        )}
        <main
          className={
            fullBleed
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex-1 overflow-auto p-4 sm:p-5 md:p-6"
          }
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
