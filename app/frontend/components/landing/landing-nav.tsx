import { Link } from "@inertiajs/react"
import { ArrowRight } from "lucide-react"

import AppLogo from "@/components/app-logo"
import { Button } from "@/components/ui/button"
import { newUserSessionPath, newUserRegistrationPath } from "@/routes"

const LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Agents", href: "#agents" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
]

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-10">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <AppLogo size="default" />
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href={newUserSessionPath()}>Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href={newUserRegistrationPath()} className="gap-1.5">
              Get started <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
