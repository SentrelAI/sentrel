import { Head, Link, usePage } from "@inertiajs/react"
import { useEffect, useRef, type ReactNode } from "react"
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Gauge,
  Lock,
  Mail,
  Plug,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"

import { Overline, StatusDot } from "@/components/brand"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { OrgGraph, OrgGraphStats } from "@/components/landing/org-graph"
import { Button } from "@/components/ui/button"
import { dashboardPath, newUserRegistrationPath } from "@/routes"
import type { SharedProps } from "@/types"

function useCta() {
  const { auth } = usePage<SharedProps>().props
  const signedIn = !!auth?.user
  return {
    href: signedIn ? dashboardPath() : newUserRegistrationPath(),
    label: signedIn ? "Open dashboard" : "Get started",
  }
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Sentrel — AI employees that live inside your tools" />
      <LandingNav />

      <Hero />
      <TemplateGallery />
      <LogoMarquee />
      <ProductDemo />
      <FeatureGrid />
      <ControlTiers />
      <SdkSplits />
      <Metrics />
      <Security />
      <Testimonial />
      <FinalCTA />

      <LandingFooter />
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════
   TEMPLATE GALLERY (pre-built teammates)
   ═════════════════════════════════════════════════════════════ */
const TEMPLATE_ACCENTS = {
  indigo: {
    surface: "var(--indigo-surface)",
    border: "var(--indigo-border)",
    text: "var(--color-indigo)",
  },
  cyan: {
    surface: "var(--cyan-surface)",
    border: "var(--cyan-border)",
    text: "var(--cyan)",
  },
  success: {
    surface: "color-mix(in oklab, var(--color-success) 12%, transparent)",
    border: "color-mix(in oklab, var(--color-success) 32%, transparent)",
    text: "var(--color-success)",
  },
} as const

function TemplateGallery() {
  const cta = useCta()
  const templates = [
    { initial: "S", name: "Sarah", role: "Sales SDR", task: "books demos", accent: "indigo" as const },
    { initial: "C", name: "Casper", role: "Chief of Staff", task: "runs your week", accent: "cyan" as const },
    { initial: "J", name: "Jamie", role: "Customer support", task: "handles tickets", accent: "success" as const },
    { initial: "P", name: "Priya", role: "Recruiting coordinator", task: "schedules interviews", accent: "indigo" as const },
    { initial: "L", name: "Leo", role: "Marketing", task: "ships campaigns", accent: "cyan" as const },
    { initial: "N", name: "Nina", role: "Executive assistant", task: "guards your calendar", accent: "success" as const },
  ]

  return (
    <section className="border-b py-20 md:py-24">
      <div className="mx-auto w-full max-w-7xl px-6">
        <div className="mb-12 max-w-3xl">
          <Overline accent dot>100+ roles</Overline>
          <h2 className="text-section mt-3 text-foreground">
            Pre-built teammates,{" "}
            <span className="serif-italic text-[var(--color-indigo)]">ready in 90 seconds</span>
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Pick from 100+ proven roles — SDR, exec assistant, support, hiring
            coordinator. Each one ships with the skills, integrations, and
            instructions it needs. You give them a name and they start working.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const accent = TEMPLATE_ACCENTS[t.accent]
            return (
              <div
                key={t.name}
                className="group relative flex flex-col overflow-hidden rounded-xl border bg-card p-6 transition-all hover:border-[var(--border-strong)]"
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border font-display text-base font-semibold"
                    style={{
                      background: accent.surface,
                      borderColor: accent.border,
                      color: accent.text,
                    }}
                  >
                    {t.initial}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                      {t.name} <span className="text-muted-foreground">· {t.role}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <StatusDot status="online" />
                      {t.task}
                    </div>
                  </div>
                </div>

                <Link
                  href={cta.href}
                  className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-md border bg-[var(--muted)] px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:border-[var(--color-indigo)] hover:text-[var(--color-indigo)]"
                >
                  Hire {t.name} now
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            )
          })}
        </div>

        <div className="mt-8">
          <Link
            href={cta.href}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
          >
            Browse the full library of 100+ roles
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   1 — HERO (animated pattern)
   ═════════════════════════════════════════════════════════════ */
function Hero() {
  const cta = useCta()
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return

    let raf = 0
    let targetX = 50
    let targetY = 50
    let currentX = 50
    let currentY = 50
    let hasMoved = false

    function onMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect()
      targetX = ((e.clientX - rect.left) / rect.width) * 100
      targetY = ((e.clientY - rect.top) / rect.height) * 100
      if (!hasMoved) {
        hasMoved = true
        el!.style.setProperty("--mx-active", "1")
      }
      if (!raf) raf = requestAnimationFrame(tick)
    }

    function onLeave() {
      el!.style.setProperty("--mx-active", "0")
      hasMoved = false
    }

    function tick() {
      // Smooth easing toward cursor
      currentX += (targetX - currentX) * 0.12
      currentY += (targetY - currentY) * 0.12
      el!.style.setProperty("--mx", `${currentX}%`)
      el!.style.setProperty("--my", `${currentY}%`)
      if (Math.abs(targetX - currentX) > 0.2 || Math.abs(targetY - currentY) > 0.2) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }

    el.addEventListener("mousemove", onMove)
    el.addEventListener("mouseleave", onLeave)
    return () => {
      el.removeEventListener("mousemove", onMove)
      el.removeEventListener("mouseleave", onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden border-b"
      style={{
        // @ts-expect-error CSS custom props
        "--mx": "50%",
        "--my": "50%",
        "--mx-active": "0",
      }}
    >
      {/* Animated gradient blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-1/4 top-0 h-[55vw] w-[55vw] rounded-full opacity-60 blur-3xl animate-blob-a"
          style={{ background: "radial-gradient(closest-side, var(--indigo-glow), transparent 70%)" }}
        />
        <div
          className="absolute -right-1/4 top-1/3 h-[50vw] w-[50vw] rounded-full opacity-60 blur-3xl animate-blob-b"
          style={{ background: "radial-gradient(closest-side, var(--cyan-glow), transparent 70%)" }}
        />
        <div
          className="absolute left-1/3 bottom-0 h-[35vw] w-[35vw] rounded-full opacity-40 blur-3xl animate-blob-a"
          style={{
            background: "radial-gradient(closest-side, var(--indigo-surface), transparent 70%)",
            animationDelay: "-9s",
          }}
        />
      </div>

      {/* Animated dot grid + scan */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade animate-grid-pulse"
      />
      {/* Mouse-tracked cyan spotlight — follows cursor, fades when it leaves */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          opacity: "calc(var(--mx-active, 0) * 0.9)",
          transition: "opacity 400ms ease-out",
        }}
      >
        <div
          className="absolute -inset-[20%]"
          style={{
            background:
              "radial-gradient(420px circle at var(--mx) var(--my), var(--cyan-glow) 0%, transparent 55%)",
            filter: "blur(12px)",
          }}
        />
      </div>

      {/* Diagonal noise overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0 6px, currentColor 6px 7px)",
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-20 pt-24 sm:px-6 sm:pb-28 sm:pt-28 md:pb-36 md:pt-36">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
          {/* ── Left: copy + CTAs ─────────────────────────── */}
          <div className="lg:col-span-6">
            <Link
              href="/use-cases"
              className="group mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--cyan-border)] bg-[var(--cyan-surface)] px-3.5 py-1.5 text-xs font-medium backdrop-blur transition-all hover:border-[var(--cyan)]"
            >
              <Overline accent dot>Early access</Overline>
              <span className="h-3 w-px bg-[var(--cyan-border)]" />
              <span>100+ ready-to-hire roles · No credit card</span>
              <ArrowUpRight className="size-3 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>

            <h1 className="text-hero text-foreground">
              Meet your{" "}
              <span className="serif-italic text-muted-foreground">new</span>
              <br />
              <span className="relative inline-block">
                <span className="relative z-10 serif-italic text-[var(--color-indigo)]">
                  AI team
                </span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.22em] rounded-full"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--cyan-glow), var(--indigo-glow))",
                  }}
                />
              </span>
              .
            </h1>

            <p className="mt-7 max-w-lg text-[17px] leading-relaxed text-muted-foreground">
              Hire specialists — sales, support, ops, engineering. Each one
              lives inside Slack, Gmail, your CRM, and 250+ other tools your
              team already uses. They draft, you approve, the work ships.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="group relative h-12 gap-1.5 overflow-hidden px-6 text-sm shadow-[0_0_0_1px_var(--color-indigo),0_12px_32px_-8px_var(--indigo-glow)]"
              >
                <Link href={cta.href}>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                  />
                  <span className="relative">{cta.label}</span>
                  <ArrowRight className="relative size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 gap-1.5 bg-card/60 px-6 text-sm backdrop-blur"
              >
                <Link href="/use-cases">Browse 100+ roles</Link>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
              <span className="flex items-center gap-2">
                <StatusDot status="online" pulse />
                operational
              </span>
              <span className="opacity-40">·</span>
              <span>no credit card</span>
              <span className="opacity-40">·</span>
              <span>Slack · Gmail · 250+ apps</span>
            </div>
          </div>

          {/* ── Right: animated org graph ─────────────────── */}
          <div className="lg:col-span-6">
            <OrgGraphCard />
          </div>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent"
      />
    </section>
  )
}

function OrgGraphCard() {
  return (
    <div className="relative">
      {/* Outer glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 40%, var(--indigo-glow) 0%, transparent 60%), radial-gradient(40% 40% at 80% 80%, var(--cyan-glow) 0%, transparent 60%)",
        }}
      />
      <div
        className="relative overflow-hidden rounded-xl border bg-[#0a0a0d] shadow-brutalist"
        style={{ borderColor: "rgba(255,255,255,0.10)" }}
      >
        {/* Single header row — window dots · title · live status */}
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#ff5f56]" />
              <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="size-2.5 rounded-full bg-[#27c93f]" />
            </div>
            <span className="font-display text-sm font-semibold tracking-[-0.01em] text-white">
              Workforce
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
              9 agents
            </span>
          </div>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--cyan-strong)]">
            <StatusDot status="working" pulse />
            live
          </span>
        </div>

        {/* Graph */}
        <div className="p-3" style={{ color: "rgba(255,255,255,0.9)" }}>
          <OrgGraph />
        </div>

        {/* Live stats footer */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}
        >
          <OrgGraphStats />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            streaming · sentrel.ai/v0.9
          </span>
        </div>
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════
   2 — LOGO MARQUEE
   ═════════════════════════════════════════════════════════════ */
function LogoMarquee() {
  const logos = [
    "Linear", "Slack", "Notion", "Stripe", "HubSpot", "Salesforce",
    "Gmail", "Intercom", "Zendesk", "Twilio", "Shopify", "Segment",
    "Airtable", "Asana", "ClickUp", "Plaid", "QuickBooks", "PostHog",
  ]

  return (
    <section className="border-b bg-background py-12">
      <div className="mx-auto w-full max-w-7xl px-6">
        <p className="mb-8 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Agents work inside the tools you already pay for
        </p>
        <div className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-background to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-background to-transparent"
          />
          <div className="flex w-max animate-marquee items-center gap-10 pr-10 md:gap-16 md:pr-16">
            {[...logos, ...logos].map((name, i) => (
              <span
                key={i}
                className="whitespace-nowrap font-display text-base font-medium tracking-tight text-muted-foreground/70 transition-colors hover:text-foreground md:text-xl"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   3 — PRODUCT DEMO (terminal preview)
   ═════════════════════════════════════════════════════════════ */
function ProductDemo() {
  return (
    <section id="demo" className="relative overflow-hidden border-b py-24 md:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(40% 50% at 20% 50%, var(--indigo-glow) 0%, transparent 55%), radial-gradient(30% 40% at 80% 60%, var(--cyan-glow) 0%, transparent 60%)",
        }}
      />

      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <Overline accent dot>Approvals</Overline>
          <h2 className="text-section mt-4 text-foreground">
            Your agent{" "}
            <span className="serif-italic text-muted-foreground">drafts</span>.
            <br />
            <span className="serif-italic text-[var(--color-indigo)]">You</span>{" "}
            approve.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Every outbound message — email, Slack reply, WhatsApp DM — lands in
            a unified inbox as a{" "}
            <span className="serif-italic text-foreground">draft</span>. Skim, tap
            approve, it ships. Agents never speak for you without a human signing off.
          </p>
          <ul className="mt-6 space-y-2.5 border-t pt-5">
            {[
              "Token-level run traces",
              "Tool-call trees with diffs",
              "Cost + latency per agent",
              "Replayable transcripts",
            ].map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-[13px] text-foreground"
              >
                <CheckCircle2 className="size-3.5 text-[var(--cyan)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-8">
          <TerminalPreview />
        </div>
      </div>
    </section>
  )
}

function TerminalPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 blur-2xl opacity-60"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, var(--indigo-glow) 0%, transparent 60%)",
        }}
      />
      <div className="relative overflow-hidden rounded-xl border bg-[#0b0b0d] shadow-brutalist">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#ff5f56]" />
            <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="size-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-3 font-mono text-[11px] text-white/60">
              app.sentrel.ai/runs/run_4fc1
            </span>
          </div>
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--cyan-strong)]">
            <StatusDot status="working" pulse />
            Running
          </span>
        </div>

        <div className="grid grid-cols-12 text-white">
          {/* Left rail — agents */}
          <div className="col-span-3 border-r border-white/10 p-4 text-[13px]">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
              Roster
            </p>
            <div className="space-y-1">
              <div className="rounded-md border border-[var(--cyan)]/40 bg-[var(--cyan)]/10 px-3 py-1.5">
                <span className="flex items-center gap-2 text-white">
                  <Bot className="size-3.5 text-[var(--cyan)]" />
                  Alex
                  <span className="ml-auto text-[10px] text-white/50">SDR</span>
                </span>
              </div>
              {["Morgan (Ops)", "Jamie (CX)", "Riley (Analyst)"].map((n) => (
                <div
                  key={n}
                  className="rounded-md px-3 py-1.5 text-[12px] text-white/60"
                >
                  {n}
                </div>
              ))}
            </div>
          </div>

          {/* Main trace */}
          <div className="col-span-6 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--cyan)]">
                  Run · 4fc1 · +12.4s
                </p>
                <h3 className="mt-1 font-display text-base font-semibold">
                  Qualify inbound from Priya Shah
                </h3>
              </div>
              <span className="rounded-sm border border-white/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/70">
                gpt-5
              </span>
            </div>

            <div className="mt-5 space-y-0.5">
              {[
                { icon: <Mail className="size-3" />, text: "search_contact(email='priya@acme.co')", meta: "0.4s" },
                { icon: <Database className="size-3" />, text: "hubspot.lookup('acme.co')", meta: "0.9s" },
                { icon: <Mail className="size-3" />, text: "gmail.send_draft(to='priya@acme.co')", meta: "1.2s" },
                { icon: <ShieldCheck className="size-3" />, text: "approval_required('discount>15%')", meta: "⏸ waiting", warn: true },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md px-2 py-1 font-mono text-[12px] transition-colors hover:bg-white/[0.04]"
                >
                  <span className="flex items-center gap-2 text-white/90">
                    <span
                      className={
                        row.warn
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--cyan-strong)]"
                      }
                    >
                      {row.icon}
                    </span>
                    {row.text}
                  </span>
                  <span className="text-[10px] text-white/50">{row.meta}</span>
                </div>
              ))}
            </div>

            <div
              className="mt-5 overflow-hidden rounded-md"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-1.5"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
                  gmail.send_draft
                </span>
                <span className="font-mono text-[10px] text-[var(--cyan-strong)]">
                  ok · 200
                </span>
              </div>
              <pre className="overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-white/80">
{`To: priya@acme.co
Subject: Your interest in Sentrel

Hi Priya — saw you signed up Monday. Acme
is exactly the kind of team we built for…`}
              </pre>
            </div>
          </div>

          {/* Right rail */}
          <div className="col-span-3 space-y-5 border-l border-white/10 bg-white/[0.02] p-5 text-[13px] text-white/85">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
                Tokens
              </p>
              <p className="mt-1 font-display text-2xl font-semibold">14.2k</p>
              <p className="font-mono text-[10px] text-white/50">3.1k cached</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
                Cost
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-[var(--cyan-strong)]">
                $0.042
              </p>
              <p className="font-mono text-[10px] text-white/50">within budget</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
                Latency
              </p>
              <p className="mt-1 font-display text-2xl font-semibold">2.1s</p>
              <p className="font-mono text-[10px] text-white/50">p95 · 3.4s</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════
   4 — FEATURE GRID (why Sentrel)
   ═════════════════════════════════════════════════════════════ */
function FeatureGrid() {
  const features = [
    {
      n: "01",
      icon: Bot,
      title: "Teammates, not assistants",
      body: "Each agent has a name, a role, and a job description. Sarah handles inbound sales. Casper runs ops. Jamie answers support. They don't share a brain — they each have their own context, their own tools, their own working hours.",
      example: "Hire Sarah — your new SDR",
    },
    {
      n: "02",
      icon: Plug,
      title: "Lives inside the tools you already use",
      body: "Your agents log into Slack, Gmail, HubSpot, Notion, and 250+ other apps the way a new hire would. They send emails from your domain, post in channels, update your CRM. No extra dashboards to learn.",
      example: "Connected: Gmail · Slack · HubSpot",
    },
    {
      n: "03",
      icon: ShieldCheck,
      title: "You decide what they do alone",
      body: "Per-action policy — send routine emails on their own, ask before issuing refunds, never delete data. Drafts land in your inbox for one-click approve. Like a junior teammate who knows what to escalate.",
      example: "Refunds → ask me first",
    },
    {
      n: "04",
      icon: Gauge,
      title: "See exactly what they did",
      body: "Every email, every tool call, every decision. Search the timeline, replay the conversation, see the cost. The receipts every CFO and every compliance team asks for — without having to ask.",
      example: "View activity → 14 actions today",
    },
  ]

  return (
    <section
      id="platform"
      className="relative overflow-hidden border-b py-24 md:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -right-1/4 top-1/4 h-[40vw] w-[40vw] rounded-full opacity-40 blur-3xl animate-blob-b"
          style={{ background: "radial-gradient(closest-side, var(--indigo-glow), transparent 70%)" }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-6">
        <div className="mb-16 max-w-3xl">
          <Overline>Why Sentrel</Overline>
          <h2 className="text-section mt-3 text-foreground">
            The team you'd build{" "}
            <span className="serif-italic text-muted-foreground">yourself</span> —
            <br />
            without the{" "}
            <span className="relative inline-block">
              <span className="relative z-10 serif-italic text-[var(--color-indigo)]">
                six months
              </span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.22em] rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, var(--cyan-glow), var(--indigo-glow))",
                }}
              />
            </span>
            {" "}of hiring.
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Most AI tools give you one chatbot. Sentrel gives you a whole team — specialists who know their role, log into your tools, and run on their own. You stay the editor.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.n}
              className="group relative overflow-hidden rounded-xl border bg-card p-7 transition-all hover:border-[var(--border-strong)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-md border border-[var(--indigo-border)] bg-[var(--indigo-surface)] text-[var(--color-indigo)] transition-colors group-hover:border-[var(--color-indigo)]">
                  <f.icon className="size-4" />
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60">
                  {f.n}
                </span>
              </div>
              <h3 className="mt-6 font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
                {f.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
                {f.body}
              </p>
              <div className="mt-5 rounded-md border bg-[var(--muted)] px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-[12.5px] text-foreground">
                  <CheckCircle2 className="size-3.5 shrink-0 text-[var(--color-success)]" />
                  <span>{f.example}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   5 — CONTROL TIERS (three product modes)
   ═════════════════════════════════════════════════════════════ */
function ControlTiers() {
  const tiers = [
    {
      tag: "Hire from the library",
      title: "Pre-built teammates, ready in 90 seconds",
      body: "Pick from 100+ proven roles — SDR, exec assistant, support, hiring coordinator. Each one ships with the skills, integrations, and instructions it needs. You give them a name and they start working.",
      visual: (
        <div className="space-y-2">
          {[
            { initial: "S", name: "Sarah · Sales SDR", desc: "books demos", tone: "indigo" as const },
            { initial: "C", name: "Casper · Chief of Staff", desc: "runs your week", tone: "cyan" as const },
            { initial: "J", name: "Jamie · Customer support", desc: "handles tickets", tone: "indigo" as const },
          ].map((a) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <span className="flex items-center gap-2.5">
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-md border font-display text-[12px] font-semibold"
                  style={{
                    borderColor:
                      a.tone === "cyan" ? "var(--cyan-border)" : "var(--indigo-border)",
                    background:
                      a.tone === "cyan" ? "var(--cyan-surface)" : "var(--indigo-surface)",
                    color:
                      a.tone === "cyan" ? "var(--cyan)" : "var(--color-indigo)",
                  }}
                >
                  {a.initial}
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium leading-tight">{a.name}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{a.desc}</span>
                </span>
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </div>
          ))}
        </div>
      ),
    },
    {
      tag: "Run the room",
      title: "Policies the way a manager would set them",
      body: "Daily spend caps, who can talk to whom, what needs your signoff. Set once at the team level — apply to every agent. No engineer required.",
      visual: (
        <div className="space-y-2.5">
          {[
            { label: "Daily spend ceiling", value: "$25 / agent" },
            { label: "Auto-approve", value: "Routine emails · CRM updates" },
            { label: "Always ask first", value: "Refunds · Sending to >10 people" },
            { label: "Scope", value: "Sales team" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
              <span className="text-[12px] text-muted-foreground">{row.label}</span>
              <span className="text-[12.5px] font-medium text-foreground text-right">{row.value}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      tag: "Open the hood",
      title: "Full SDK when you want to build something custom",
      body: "Engineers can drop into TypeScript — trigger on any webhook, replay any run, swap models per agent, write their own skills. The whole stack is yours when you need it.",
      visual: (
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="border-b px-3 py-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">For developers</span>
            <span className="font-mono text-[10px] text-[var(--color-indigo)]">ts</span>
          </div>
          <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed">
{`// Wake Sarah on every inbound lead.
on.webhook('/leads', async (lead) => {
  return sarah.handle(lead)
})`}
          </pre>
        </div>
      ),
    },
  ]

  return (
    <section className="relative overflow-hidden border-b py-24 md:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -left-1/4 bottom-0 h-[40vw] w-[40vw] rounded-full opacity-40 blur-3xl animate-blob-a"
          style={{ background: "radial-gradient(closest-side, var(--cyan-glow), transparent 70%)" }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-6">
        <div className="mb-14 max-w-3xl">
          <Overline>Three ways in</Overline>
          <h2 className="text-section mt-3 text-foreground">
            Hire one teammate{" "}
            <span className="serif-italic text-muted-foreground">today</span>.
            Run a{" "}
            <span className="serif-italic text-[var(--color-indigo)]">whole team</span>{" "}
            next quarter.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Start with one templated role and a Slack channel. Grow into a managed team with shared policies, budgets, and dashboards. Engineers get a full SDK if you want to build something nobody else has.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.tag}
              className="flex flex-col rounded-xl border bg-card p-6"
            >
              <Overline accent>{tier.tag}</Overline>
              <h3 className="mt-3 font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
                {tier.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {tier.body}
              </p>
              <div className="mt-6">{tier.visual}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   6 — SDK SPLITS (alternating rows)
   ═════════════════════════════════════════════════════════════ */
function SdkSplits() {
  const rows: Array<{
    eyebrow: string
    title: ReactNode
    body: string
    reverse?: boolean
    visual: ReactNode
  }> = [
    {
      eyebrow: "Connections",
      title: (<>They log in <span className="serif-italic text-[var(--color-indigo)]">once</span>. They stay logged in.</>),
      body: "Your agent connects to Slack, Gmail, your CRM, Notion — the same way you would, with one click. They handle the boring auth stuff in the background forever. No tokens to copy. No keys to rotate. No re-authorizing every 30 days.",
      visual: (
        <div className="grid grid-cols-3 gap-2">
          {["Slack", "Gmail", "HubSpot", "Notion", "Linear", "Stripe"].map((t) => (
            <div
              key={t}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2.5"
            >
              <CheckCircle2 className="size-3.5 text-[var(--color-success)]" />
              <span className="text-[12px] font-medium">{t}</span>
            </div>
          ))}
          <div className="col-span-3 mt-1 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
            and 250+ more
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Wakes up on its own",
      title: (<>Starts working when there's <span className="serif-italic text-[var(--color-indigo)]">work to do</span>.</>),
      body: "An email arrives. A Slack message pings. A scheduled time hits. A customer fills out a form. Your agent is already on it — no app to open, no button to push.",
      reverse: true,
      visual: (
        <div className="space-y-2">
          {[
            { trigger: "Email lands in your inbox", who: "Jamie", what: "triages and replies", icon: "✉️" },
            { trigger: "Slack mention in #leads", who: "Sarah", what: "qualifies the lead", icon: "💬" },
            { trigger: "Every weekday 9am", who: "Casper", what: "sends the morning brief", icon: "🕘" },
            { trigger: "New Stripe customer", who: "Morgan", what: "onboards them", icon: "💳" },
          ].map((r) => (
            <div key={r.trigger} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5">
              <span className="text-base leading-none">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium leading-tight">{r.trigger}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">
                  <span className="text-foreground/80">{r.who}</span> {r.what}
                </div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Remembers everything",
      title: "Reads your docs. Cites its sources.",
      body: "Drop in your handbook, pricing sheet, ICP notes, past tickets. Your agent reads it on demand and references the exact page when it answers. No more 'where did you get that?' — every answer comes with receipts.",
      visual: (
        <div className="space-y-2">
          {[
            { label: "ICP & qualification playbook", page: "Sales wiki · p.3" },
            { label: "Pricing & discount policy", page: "Notion · Pricing 2026" },
            { label: "Refund process", page: "Support handbook · §4" },
          ].map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5"
            >
              <span className="text-[12.5px] font-medium truncate">{d.label}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground italic">
                {d.page}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Your choice of brain",
      title: "Claude. GPT. Gemini. Your call.",
      body: "Different roles deserve different brains. Use a cheap fast model for triage and a flagship model for drafting your CEO's emails. Mix and match per agent — never locked to one AI lab.",
      reverse: true,
      visual: (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Claude (Anthropic)" },
            { label: "GPT (OpenAI)" },
            { label: "Gemini (Google)" },
            { label: "Your own model" },
          ].map((m) => (
            <div
              key={m.label}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2.5"
            >
              <StatusDot status="online" />
              <span className="text-[12px] font-medium">{m.label}</span>
            </div>
          ))}
        </div>
      ),
    },
  ]

  return (
    <section className="border-b py-24 md:py-32">
      <div className="mx-auto w-full max-w-7xl space-y-24 px-6">
        {rows.map((row) => (
          <div
            key={row.eyebrow}
            className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2"
          >
            <div className={row.reverse ? "lg:order-2" : ""}>
              <Overline>{row.eyebrow}</Overline>
              <h3 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground md:text-[2.25rem]">
                {row.title}
              </h3>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                {row.body}
              </p>
            </div>
            <div className={row.reverse ? "lg:order-1" : ""}>{row.visual}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   7 — METRICS (stat row)
   ═════════════════════════════════════════════════════════════ */
function Metrics() {
  const stats = [
    { v: "250+", l: "integrations" },
    { v: "1:1", l: "VM per agent" },
    { v: "100+", l: "role templates" },
    { v: "5", l: "min to first hire" },
  ]

  return (
    <section className="border-b py-20">
      <div className="mx-auto w-full max-w-7xl px-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-[var(--border)] md:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.l}
              className="flex flex-col items-start gap-1 bg-background p-8"
            >
              <span className="font-display text-4xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">
                {s.v}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {s.l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   8 — SECURITY
   ═════════════════════════════════════════════════════════════ */
function Security() {
  const items = [
    { icon: Lock, title: "Encrypted by default", body: "Every credential — bot tokens, API keys, cloud creds — round-trips through Rails AR encryption. Engine never holds raw secrets." },
    { icon: ShieldCheck, title: "Per-agent isolation", body: "Each agent runs in its own VM with its own /data volume. One agent's token compromise doesn't touch the rest." },
    { icon: Database, title: "Every action audited", body: "Tool call, secret fetch, approval decision — all logged with the acting human's identity. CFO + compliance ready out of the box." },
  ]

  return (
    <section className="relative overflow-hidden border-b py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, var(--indigo-glow) 0%, transparent 60%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-7xl px-6 text-center">
        <Overline>Trust</Overline>
        <h2 className="text-section mx-auto mt-3 max-w-3xl text-foreground">
          Built for teams that have to answer for it later.
        </h2>
        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {items.map((i) => (
            <div
              key={i.title}
              className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6 text-left"
            >
              <div className="flex size-9 items-center justify-center rounded-md border border-[var(--indigo-border)] bg-[var(--indigo-surface)] text-[var(--color-indigo)]">
                <i.icon className="size-4" />
              </div>
              <h3 className="font-display text-base font-semibold tracking-[-0.015em]">
                {i.title}
              </h3>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {i.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   9 — TESTIMONIAL
   ═════════════════════════════════════════════════════════════ */
function Testimonial() {
  const quotes = [
    {
      initial: "E",
      tone: "indigo" as const,
      name: "Elie Toubiana",
      role: "CEO · ScribeMD",
      quote:
        "Any time I think 'someone should handle this,' I spin up an agent for it. New role at the company, ten minutes — not three weeks of recruiting. It's the closest thing to actually scaling yourself.",
      highlight: "the closest thing to actually scaling yourself",
    },
    {
      initial: "A",
      tone: "cyan" as const,
      name: "Abdelmoumin Mokhtari",
      role: "Head of Engineering · ScribeMD",
      quote:
        "The whole stack is what you'd build internally if you had six months. Per-agent isolation, real OAuth, replayable runs, an SDK that doesn't fight you. I open the code more often than the UI.",
      highlight: "what you'd build internally if you had six months",
    },
  ]

  return (
    <section className="relative overflow-hidden border-b py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(40% 50% at 20% 50%, var(--cyan-glow) 0%, transparent 60%), radial-gradient(40% 50% at 80% 50%, var(--indigo-glow) 0%, transparent 60%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-6">
        <div className="mb-12 text-center">
          <Overline accent dot>From the early team</Overline>
          <h2 className="text-section mt-3 text-foreground">
            People who run the product{" "}
            <span className="serif-italic text-[var(--color-indigo)]">every day</span>.
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {quotes.map((q) => (
            <figure
              key={q.name}
              className="flex flex-col rounded-2xl border bg-card p-7 md:p-8"
            >
              <blockquote className="flex-1 font-display text-lg leading-relaxed text-foreground md:text-[1.35rem] md:leading-[1.5]">
                <span className="text-muted-foreground/60">"</span>
                {q.quote.split(q.highlight).map((seg, i, arr) => (
                  <span key={i}>
                    {seg}
                    {i < arr.length - 1 && (
                      <span className="cyan-mark">{q.highlight}</span>
                    )}
                  </span>
                ))}
                <span className="text-muted-foreground/60">"</span>
              </blockquote>
              <figcaption className="mt-6 flex items-center gap-3 border-t pt-5">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border font-display text-sm font-semibold"
                  style={{
                    borderColor:
                      q.tone === "cyan" ? "var(--cyan-border)" : "var(--indigo-border)",
                    background:
                      q.tone === "cyan" ? "var(--cyan-surface)" : "var(--indigo-surface)",
                    color: q.tone === "cyan" ? "var(--cyan)" : "var(--color-indigo)",
                  }}
                >
                  {q.initial}
                </span>
                <div>
                  <div className="font-display text-sm font-semibold text-foreground">
                    {q.name}
                  </div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {q.role}
                  </div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   10 — FINAL CTA
   ═════════════════════════════════════════════════════════════ */
function FinalCTA() {
  const cta = useCta()
  return (
    <section className="relative overflow-hidden py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 50%, var(--indigo-glow) 0%, transparent 55%), radial-gradient(50% 50% at 20% 50%, var(--cyan-glow) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade opacity-50"
      />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-7 px-6 text-center">
        <Overline accent dot>MIT licensed · Open source</Overline>
        <h2 className="text-hero text-foreground">
          Your agents are{" "}
          <span className="serif-italic text-muted-foreground">ready</span>.
          <br />
          <span className="relative inline-block">
            <span className="relative z-10 serif-italic text-[var(--color-indigo)]">
              Are you?
            </span>
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-[0.08em] -z-0 h-[0.22em] rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--cyan-glow), var(--indigo-glow))",
              }}
            />
          </span>
        </h2>
        <p className="max-w-xl text-[16px] text-muted-foreground">
          Free forever. Self-host in minutes. Or let us run it — your choice.
          Plug in Slack, approve your first outbound, and go do something more
          interesting than inbox triage.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 gap-1.5 px-6">
            <Link href={cta.href}>
              {cta.label} <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 gap-1.5 px-6">
            <a
              href="https://github.com/your-org/sentrel"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.07 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.8 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.6.23 2.78.12 3.07.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.07.78 2.16v3.2c0 .31.21.68.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
              </svg>
              Star on GitHub
            </a>
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-6 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3" /> No credit card
          </span>
          <span className="flex items-center gap-1.5">
            <Cpu className="size-3" /> Self-host available
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3" /> Free 14-day trial
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="size-3" /> Cancel anytime
          </span>
        </div>
      </div>
    </section>
  )
}
