import { useState, useEffect } from "react"

type Theme = "light" | "dark" | "system"

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system"
    return (localStorage.getItem("theme") as Theme) || "system"
  })

  useEffect(() => {
    const root = document.documentElement

    function apply(t: Theme) {
      if (t === "system") {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches
        root.classList.toggle("dark", isDark)
      } else {
        root.classList.toggle("dark", t === "dark")
      }
    }

    apply(theme)
    localStorage.setItem("theme", theme)

    // Listen for system changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => { if (theme === "system") apply("system") }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  function setTheme(t: Theme) {
    setThemeState(t)
  }

  return { theme, setTheme }
}
