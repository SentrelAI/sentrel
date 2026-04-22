import type { ComponentPropsWithoutRef } from "react"
import { cn } from "@/lib/utils"

interface GlowCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Glow intensity behind the card */
  glow?: "none" | "soft" | "strong"
  /** Tint of the glow — cyan (signal) or indigo (primary) */
  tint?: "cyan" | "indigo"
  /** Brutalist 4px-offset shadow — reserve for ONE high-signal card per view */
  brutalist?: boolean
  /** Thin accent top border */
  ledge?: boolean
}

export function GlowCard({
  className,
  children,
  glow = "none",
  tint = "cyan",
  brutalist = false,
  ledge = false,
  ...props
}: GlowCardProps) {
  return (
    <div className={cn("relative", glow !== "none" && "isolate")}>
      {glow !== "none" && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -inset-4 rounded-[inherit] blur-2xl transition-opacity",
            glow === "soft" ? "opacity-40" : "opacity-70",
          )}
          style={{
            background: `radial-gradient(60% 60% at 50% 30%, var(--${tint}-glow) 0%, transparent 70%)`,
          }}
        />
      )}
      <div
        {...props}
        className={cn(
          "relative rounded-lg border bg-card text-card-foreground",
          "transition-[border-color,transform,box-shadow] duration-200",
          "hover:border-[var(--border-strong)]",
          brutalist && "shadow-brutalist hover:-translate-y-0.5 hover:-translate-x-0.5",
          ledge && "border-t-2",
          ledge && tint === "cyan" && "border-t-[var(--cyan)]",
          ledge && tint === "indigo" && "border-t-[var(--color-indigo)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
