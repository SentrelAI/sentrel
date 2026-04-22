import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  /** Small uppercase label above the title */
  eyebrow?: string
  title: string | ReactNode
  description?: string | ReactNode
  action?: ReactNode
  /** Extra content rendered between title block and action (meta chips, status, etc.) */
  meta?: ReactNode
  className?: string
  size?: "default" | "compact"
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  meta,
  className,
  size = "default",
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between",
        size === "default" ? "mb-8" : "mb-6",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {eyebrow && <span className="text-eyebrow">{eyebrow}</span>}
        <h1
          className={cn(
            "font-display font-semibold tracking-[-0.025em] text-foreground",
            size === "default" ? "text-2xl md:text-3xl" : "text-xl md:text-2xl",
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}
