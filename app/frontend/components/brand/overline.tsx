import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/lib/utils"

interface OverlineProps extends ComponentPropsWithoutRef<"span"> {
  accent?: boolean
  dot?: boolean
}

export function Overline({ className, accent, dot, children, ...props }: OverlineProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em]",
        accent ? "text-[var(--cyan)]" : "text-muted-foreground",
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            accent ? "bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]" : "bg-muted-foreground/60",
          )}
        />
      )}
      {children}
    </span>
  )
}
