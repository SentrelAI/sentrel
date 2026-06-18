interface AppLogoProps {
  size?: "sm" | "default" | "lg"
  variant?: "full" | "mark"
}

/**
 * Sentrel logomark — a small indigo-to-cyan gradient diamond that
 * pairs with the wordmark. When variant="mark" only the square renders.
 */
function Mark({ px = 18 }: { px?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: px, height: px }}
    >
      <span
        className="absolute inset-0 rotate-45 rounded-[4px]"
        style={{
          background:
            "linear-gradient(135deg, var(--color-indigo) 0%, var(--cyan) 100%)",
          boxShadow: "0 0 12px var(--indigo-glow)",
        }}
      />
      <span
        className="absolute inset-[22%] rotate-45 rounded-[2px] bg-background"
      />
    </span>
  )
}

export default function AppLogo({ size = "default", variant = "full" }: AppLogoProps) {
  const textSize =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-base" : "text-xl"
  const markPx = size === "lg" ? 24 : size === "sm" ? 14 : 18

  if (variant === "mark") {
    return <Mark px={markPx} />
  }

  return (
    <div className="flex items-center gap-2">
      <Mark px={markPx} />
      <span
        className={`leading-none tracking-[-0.015em] text-foreground ${textSize}`}
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontWeight: 400,
        }}
      >
        Sentrel
      </span>
    </div>
  )
}
