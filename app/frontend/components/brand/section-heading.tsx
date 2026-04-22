import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SectionHeadingProps {
  eyebrow?: string
  title: string | ReactNode
  description?: string | ReactNode
  align?: "left" | "center"
  className?: string
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      {eyebrow && <span className="text-eyebrow">{eyebrow}</span>}
      <h2 className="text-section text-foreground max-w-3xl">{title}</h2>
      {description && (
        <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
