interface AppLogoProps {
  size?: "sm" | "default" | "lg"
  variant?: "full" | "mark"
}

export default function AppLogo({ size = "default", variant = "full" }: AppLogoProps) {
  const textSize = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base"

  if (variant === "mark") {
    return (
      <span
        className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--cyan-border)] bg-[var(--cyan-surface)] font-display text-[13px] font-bold tracking-tight text-foreground"
        aria-label="Alchemy"
      >
        A
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`font-display font-semibold tracking-[-0.03em] ${textSize} text-foreground`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        Alchemy<span className="text-[var(--cyan)]">.</span>
      </span>
    </div>
  )
}
