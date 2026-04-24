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
        "flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4",
        size === "default" ? "mb-6 md:mb-8" : "mb-5 md:mb-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5 md:gap-2">
        {eyebrow && <span className="text-eyebrow">{eyebrow}</span>}
        <h1
          className={cn(
            "font-display font-semibold tracking-[-0.025em] text-foreground",
            size === "default"
              ? "text-[1.5rem] leading-[1.15] sm:text-2xl md:text-3xl"
              : "text-xl md:text-2xl",
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-[0.875rem] leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
            {description}
          </p>
        )}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
      </div>
      {action && (
        <div className="flex flex-wrap items-center gap-2 md:shrink-0">{action}</div>
      )}
    </div>
  )
}
