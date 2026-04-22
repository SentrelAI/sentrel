import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/lib/utils"

interface OverlineProps extends ComponentPropsWithoutRef<"span"> {
  accent?: boolean
}

export function Overline({ className, accent, children, ...props }: OverlineProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em]",
        accent ? "text-[var(--color-cyan)]" : "text-muted-foreground",
        className,
      )}
    >
      {accent && (
        <span className="size-1.5 rounded-full bg-[var(--color-cyan)] shadow-[0_0_8px_var(--color-cyan)]" />
      )}
      {children}
    </span>
  )
}
