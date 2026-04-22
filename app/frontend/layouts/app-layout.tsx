import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { TopBar, type Crumb } from "@/components/top-bar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

interface AppLayoutProps {
  children: ReactNode
  /** Crumb trail shown in the top bar */
  crumbs?: Crumb[]
  /** Right-aligned actions in the top bar (buttons, search, etc.) */
  topBarActions?: ReactNode
  /** Content rendered below the crumb line in the top bar (tabs, filters) */
  topBarExtra?: ReactNode
  /** Escape hatch: fully custom top bar */
  header?: ReactNode
  /** Disable default main padding (useful for chat/full-bleed views) */
  fullBleed?: boolean
}

export default function AppLayout({
  children,
  crumbs,
  topBarActions,
  topBarExtra,
  header,
  fullBleed = false,
}: AppLayoutProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {header ?? (
          <TopBar crumbs={crumbs} actions={topBarActions}>
            {topBarExtra}
          </TopBar>
        )}
        <main className={fullBleed ? "flex-1 overflow-auto" : "flex-1 overflow-auto p-6"}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
