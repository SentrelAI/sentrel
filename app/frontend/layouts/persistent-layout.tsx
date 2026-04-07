import type { ReactNode } from "react"

import { Toaster } from "@/components/ui/sonner"

interface PersistentLayoutProps {
  children: ReactNode
}

export default function PersistentLayout({ children }: PersistentLayoutProps) {
  return (
    <>
      {children}
      <Toaster richColors />
    </>
  )
}
