import { Link } from "@inertiajs/react"
import { Bot, Shield, Users, Zap } from "lucide-react"
import type { ReactNode } from "react"

import AppLogo from "@/components/app-logo"
import { Overline } from "@/components/brand"

interface AuthLayoutProps {
  title: ReactNode
  description: ReactNode
  children: ReactNode
  footer: ReactNode
  /** Small label above the title */
  eyebrow?: string
}

const FEATURES = [
  { icon: Bot, title: "Any role", desc: "SDR, ops, finance, content." },
  { icon: Zap, title: "Always on", desc: "Schedules, webhooks, 24/7." },
  { icon: Shield, title: "You control", desc: "Policy-gated approvals." },
  { icon: Users, title: "Team play", desc: "Agents delegate to agents." },
]

export function AuthLayout({
  title,
  description,
  eyebrow,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Left: Brand panel */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r bg-card p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 gradient-hero opacity-70"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade opacity-50"
        />

        <div className="relative">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <AppLogo size="lg" />
          </Link>
        </div>

        <div className="relative space-y-10">
          <div className="space-y-4">
            <Overline accent dot>
              AI employees
            </Overline>
            <h1 className="font-display text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-foreground md:text-5xl">
              Your AI teammates,
              <br />
              <span className="cyan-mark">ready for Monday.</span>
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Hire an agent, plug in your tools, set the policy. It shows up
              to work inside Slack, email, and your CRM.
            </p>
          </div>

          <div className="grid max-w-md grid-cols-2 gap-2">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-3 rounded-md border bg-background/60 p-3 backdrop-blur"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-[var(--color-indigo)]" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground">{title}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          Sentrel · Turn effort into outcome
        </p>
      </aside>

      {/* Right: Form panel */}
      <main className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Link href="/">
              <AppLogo />
            </Link>
          </div>

          <div className="mb-8 space-y-2">
            {eyebrow && <Overline>{eyebrow}</Overline>}
            <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground md:text-3xl">
              {title}
            </h2>
            <p className="text-[14px] text-muted-foreground">{description}</p>
          </div>

          {children}

          <div className="mt-10 border-t pt-6 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        </div>
      </main>
    </div>
  )
}
