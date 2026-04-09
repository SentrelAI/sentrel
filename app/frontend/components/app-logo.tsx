export default function AppLogo({ size = "default" }: { size?: "default" | "lg" }) {
  const textSize = size === "lg" ? "text-2xl" : "text-base"

  return (
    <div className="flex items-center">
      <span className={`font-medium tracking-tight ${textSize} text-foreground`}>
        ALCHEMY<span className="text-[var(--color-cyan)]">.</span>
      </span>
    </div>
  )
}
