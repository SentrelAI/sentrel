import { cn } from "@/lib/utils"

interface AppLogoProps {
  size?: "sm" | "default" | "lg"
  /** "full" → the Sentrel wordmark. "mark" → the compact S monogram. */
  variant?: "full" | "mark"
  className?: string
}

/**
 * Sentrel logo — a pure-typography wordmark set in the brand identity face
 * (Goldman, a squared/techy display face, via --font-brand). No icon: the
 * letterforms are the mark. Swap the typeface in global.css (--font-brand +
 * its @import) to try another identity — every logo on the site follows.
 */
export default function AppLogo({ size = "default", variant = "full", className }: AppLogoProps) {
  const textSize =
    size === "lg" ? "text-[28px] md:text-[32px]" : size === "sm" ? "text-base" : "text-xl"

  return (
    <span
      className={cn(
        "inline-block select-none leading-none tracking-[0.02em] text-foreground",
        textSize,
        className,
      )}
      style={{ fontFamily: "var(--font-brand)", fontWeight: 700 }}
    >
      {variant === "mark" ? "S" : "Sentrel"}
    </span>
  )
}
