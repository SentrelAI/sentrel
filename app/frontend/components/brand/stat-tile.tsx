import type { ComponentPropsWithoutRef, ReactNode } from "react"
import { cn } from "@/lib/utils"

interface StatTileProps extends ComponentPropsWithoutRef<"div"> {
  label: string
  value: ReactNode
  delta?: { value: string; direction: "up" | "down" | "flat" }
  icon?: ReactNode
  accent?: boolean
}

export function StatTile({
  label,
  value,
  delta,
  icon,
  accent = false,
  className,
  ...props
}: StatTileProps) {
  return (
    <div
      {...props}
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border bg-card p-5",
        "transition-[border-color,transform] duration-200",
        "hover:border-[var(--border-strong)]",
        accent && "border-[var(--cyan-border)] bg-[var(--cyan-surface)]",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="overline">{label}</span>
        {icon && (
          <span className={cn("text-muted-foreground", accent && "text-[var(--cyan)]")}>
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-stat text-foreground">{value}</span>
        {delta && (
          <span
            className={cn(
              "font-mono text-xs font-medium",
              delta.direction === "up" && "text-[var(--color-success)]",
              delta.direction === "down" && "text-[var(--destructive)]",
              delta.direction === "flat" && "text-muted-foreground",
            )}
          >
            {delta.direction === "up" ? "↑" : delta.direction === "down" ? "↓" : "→"} {delta.value}
          </span>
        )}
      </div>
    </div>
  )
}
