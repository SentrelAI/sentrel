export default function AppLogo({ size = "default" }: { size?: "default" | "lg" }) {
  const textSize = size === "lg" ? "text-2xl" : "text-base"

  return (
    <div className="flex items-center">
      <span className={`font-extrabold tracking-tight ${textSize}`}>
        ALCHEMY<span className="text-[#D4A843]">.</span>
      </span>
    </div>
  )
}
