import { Link } from "@inertiajs/react"

import AppLogo from "@/components/app-logo"

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { label: "Agents", href: "#agents" },
      { label: "Integrations", href: "#integrations" },
      { label: "Channels", href: "#channels" },
      { label: "Observability", href: "#observability" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "#docs" },
      { label: "Changelog", href: "#changelog" },
      { label: "Blog", href: "#blog" },
      { label: "API reference", href: "#api" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Careers", href: "#careers" },
      { label: "Contact", href: "#contact" },
      { label: "Press", href: "#press" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "#privacy" },
      { label: "Terms", href: "#terms" },
      { label: "Security", href: "#security" },
      { label: "DPA", href: "#dpa" },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <Link href="/" className="transition-opacity hover:opacity-80">
              <AppLogo size="lg" />
            </Link>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              AI employees that live inside your tools. Hire once, work forever.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title} className="md:col-span-2">
              <span className="text-eyebrow text-xs">{col.title}</span>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t pt-8 sm:flex-row sm:items-center">
          <span className="font-mono text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sentrel. All systems nominal.
          </span>
          <div className="flex items-center gap-2">
            <span className="relative inline-flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
              <span className="relative size-2 rounded-full bg-[var(--color-success)]" />
            </span>
            <span className="font-mono text-xs text-muted-foreground">operational</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
