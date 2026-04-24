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
  TerminalSquare,
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
      <Head title="Alchemy — AI employees that live inside your tools" />
      <LandingNav />

      <Hero />
      <LogoMarquee />
      <ProductDemo />
      <FeatureGrid />
      <ControlTiers />
      <SdkSplits />
      <Metrics />
      <Security />
      <Testimonial />
      <BrandMoment />
      <FinalCTA />

      <LandingFooter />
    </div>
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
            <a
              href="https://github.com/your-org/alchemy"
              target="_blank"
              rel="noopener noreferrer"
              className="group mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--cyan-border)] bg-[var(--cyan-surface)] px-3.5 py-1.5 text-xs font-medium backdrop-blur transition-all hover:border-[var(--cyan)]"
            >
              <Overline accent dot>Open source</Overline>
              <span className="h-3 w-px bg-[var(--cyan-border)]" />
              <span>MIT licensed · Star on GitHub</span>
              <ArrowUpRight className="size-3 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>

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
              Hire a CEO agent. It delegates to Marketing, Sales, Engineering,
              and Ops — each reachable on email, Slack, WhatsApp, and Telegram.
              Free, open source, and forever yours to self-host.
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
                <a
                  href="https://github.com/your-org/alchemy"
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
                  See on GitHub
                </a>
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
              <span>self-host available</span>
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
            streaming · alchemy/v0.9
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
              app.alchemy.ai/runs/run_4fc1
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
Subject: Your interest in Alchemy

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
   4 — FEATURE GRID (why Alchemy)
   ═════════════════════════════════════════════════════════════ */
function FeatureGrid() {
  const features = [
    {
      n: "01",
      icon: Bot,
      title: "Agents that specialize",
      body: "Roles, skills, schedules. Each agent has a distinct job, its own memory, budget, and approvals.",
      example: "defineAgent({ name: 'Alex', role: 'SDR' })",
    },
    {
      n: "02",
      icon: Plug,
      title: "Native tools, not scrapers",
      body: "OAuth into Slack, Salesforce, Gmail, Notion, Linear, and 40+ more. Real APIs, not DOM tricks.",
      example: "tools: [slack, gmail, salesforce]",
    },
    {
      n: "03",
      icon: ShieldCheck,
      title: "Policy-gated autonomy",
      body: "Set rules — auto-approve send-email, require your nod on refunds. Humans approve what matters.",
      example: "requireApproval: ['offer_discount']",
    },
    {
      n: "04",
      icon: Gauge,
      title: "Observability, end-to-end",
      body: "Token-level traces, tool-call trees, cost per agent, replayable transcripts. No mysteries.",
      example: "replay(run_4fc1)",
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
          <Overline>Why Alchemy</Overline>
          <h2 className="text-section mt-3 text-foreground">
            Primitives you'd build{" "}
            <span className="serif-italic text-muted-foreground">yourself</span> —
            <br />
            in{" "}
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
            , not six hours.
          </h2>
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
              <div className="mt-5 overflow-hidden rounded-md border bg-[var(--muted)]">
                <div className="flex items-center justify-between border-b px-3 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    example
                  </span>
                  <span className="font-mono text-[10px] text-[var(--color-indigo)]">
                    ts
                  </span>
                </div>
                <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                  {f.example}
                </pre>
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
      tag: "For you",
      title: "Zero-code templates",
      body: "Pick a proven agent. Plug in Slack + your CRM. Ship in 90 seconds.",
      visual: (
        <div className="space-y-2">
          {[
            { name: "Alex · SDR", tone: "indigo" as const },
            { name: "Morgan · Ops", tone: "cyan" as const },
            { name: "Jamie · CX", tone: "indigo" as const },
          ].map((a) => (
            <div
              key={a.name}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <span
                  className="size-6 rounded-md border"
                  style={{
                    borderColor:
                      a.tone === "cyan" ? "var(--cyan-border)" : "var(--indigo-border)",
                    background:
                      a.tone === "cyan" ? "var(--cyan-surface)" : "var(--indigo-surface)",
                  }}
                />
                <span className="text-[13px] font-medium">{a.name}</span>
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </div>
          ))}
        </div>
      ),
    },
    {
      tag: "Platform",
      title: "Full policy engine",
      body: "Budgets. Schedules. Permissions. Roll out across your whole team with one config.",
      visual: (
        <div className="overflow-hidden rounded-md border bg-card">
          <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed">
{`policy({
  budget:   { daily: 25, unit: 'usd' },
  approve:  ['send_email', 'log_contact'],
  require:  ['offer_discount', 'refund'],
  scope:    team('sales')
})`}
          </pre>
        </div>
      ),
    },
    {
      tag: "Developers",
      title: "Typed SDK + webhooks",
      body: "First-class TypeScript. Trigger on any event. Replay any run. Drop to raw prompts if you want.",
      visual: (
        <div className="overflow-hidden rounded-md border bg-card">
          <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed">
{`import { on } from '@alchemy/core'

on.webhook('/inbound', async (e) => {
  const run = await alex.handle(e)
  return run.trace
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
          <Overline>Zero code → full control</Overline>
          <h2 className="text-section mt-3 text-foreground">
            Start{" "}
            <span className="serif-italic text-muted-foreground">soft</span>.
            Scale{" "}
            <span className="serif-italic text-[var(--color-indigo)]">deep</span>.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Ship a templated agent in minutes. Open the SDK when you're ready
            to bend it to your workflow.
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
      eyebrow: "Managed auth",
      title: (<>OAuth that <span className="serif-italic text-[var(--color-indigo)]">stays</span> signed in.</>),
      body: "Every integration. Token refresh, scope management, revocation — handled. Your agent doesn't know what a refresh token is, and it doesn't have to.",
      visual: (
        <div className="grid grid-cols-3 gap-2">
          {["Slack", "Gmail", "HubSpot", "Linear", "Stripe", "Notion"].map((t) => (
            <div
              key={t}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-2.5"
            >
              <CheckCircle2 className="size-3.5 text-[var(--color-success)]" />
              <span className="text-[12px] font-medium">{t}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Triggers",
      title: (<>Wake up when work <span className="serif-italic text-[var(--color-indigo)]">arrives</span>.</>),
      body: "Cron. Webhooks. Inbound email. Slack mention. Calendar event. Your agent starts running the moment there's something to do.",
      reverse: true,
      visual: (
        <div className="overflow-hidden rounded-md border bg-card">
          <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed">
{`on.email('support@acme.co',   jamie.triage)
on.slack('#inbound',          alex.qualify)
on.schedule('* 9 * * 1-5',    riley.report)
on.webhook('/stripe',         morgan.reconcile)`}
          </pre>
        </div>
      ),
    },
    {
      eyebrow: "Context-aware",
      title: "Memory that survives restarts.",
      body: "Per-agent long-term memory. RAG over your docs. Retrieval with citations. Forget about managing vector databases.",
      visual: (
        <div className="space-y-2">
          {[
            { label: "docs/pricing.md", score: "0.94" },
            { label: "wiki/ICP.md", score: "0.87" },
            { label: "notes/q3-plan.md", score: "0.71" },
          ].map((d) => (
            <div
              key={d.label}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
            >
              <span className="font-mono text-[12px]">{d.label}</span>
              <span className="rounded-sm bg-[var(--indigo-surface)] px-1.5 font-mono text-[10px] text-[var(--color-indigo)]">
                {d.score}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Model-agnostic",
      title: "Claude. GPT. Gemini. Your call.",
      body: "Swap models per agent. Mix cheap models for triage with flagship models for writing. You're not locked to any one lab.",
      reverse: true,
      visual: (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Claude 4.6 Sonnet", ok: true },
            { label: "GPT-5", ok: true },
            { label: "Gemini 2.5 Pro", ok: true },
            { label: "Self-hosted Llama", ok: true },
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
    { v: "10k+", l: "agents running" },
    { v: "40+", l: "integrations" },
    { v: "99.9%", l: "uptime · last 90d" },
    { v: "< 2s", l: "p95 tool latency" },
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
    { icon: Lock, title: "SOC 2 in progress", body: "Type II audit underway. DPA + BAA on request." },
    { icon: ShieldCheck, title: "Scoped tool access", body: "Per-agent OAuth scopes. Revoke in one click." },
    { icon: Database, title: "Your data, your region", body: "Pin tenants to US, EU, or self-host." },
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
        <Overline>Safety</Overline>
        <h2 className="text-section mx-auto mt-3 max-w-3xl text-foreground">
          Built for teams that have lawyers.
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
      <div className="relative mx-auto w-full max-w-5xl px-6 text-center">
        <Overline accent dot>Case study · Acme</Overline>
        <blockquote className="mt-8 font-display text-3xl font-medium leading-[1.1] tracking-[-0.025em] text-foreground md:text-[3.25rem]">
          "We hired Alex on Thursday.
          <br />
          By Monday it had touched <span className="cyan-mark">400 leads</span>,
          logged every conversation, and flagged three enterprise deals."
        </blockquote>
        <div className="mt-10 flex items-center justify-center gap-4">
          <div className="size-11 rounded-full border bg-[var(--indigo-surface)]" />
          <div className="text-left">
            <div className="font-display text-sm font-semibold text-foreground">
              Priya Shah
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Head of Growth · Acme
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   10 — BRAND MOMENT (oversized wordmark)
   ═════════════════════════════════════════════════════════════ */
function BrandMoment() {
  return (
    <section className="relative overflow-hidden border-b py-20 md:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade opacity-50"
      />
      <div className="relative mx-auto w-full max-w-7xl px-6">
        <div className="flex items-end justify-between gap-6">
          <div className="max-w-sm space-y-3">
            <Overline>The brand</Overline>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Alchemy turns effort into outcome. Hire once, work forever.
            </p>
          </div>
          <div className="hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground md:flex">
            <StatusDot status="online" pulse /> all systems nominal
          </div>
        </div>
        <h2
          className="mt-10 select-none font-display font-semibold leading-none tracking-[-0.06em] text-foreground"
          style={{ fontSize: "clamp(4rem, 18vw, 16rem)" }}
        >
          Alchemy<span className="text-[var(--cyan)]">.</span>
        </h2>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════
   11 — FINAL CTA
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
              href="https://github.com/your-org/alchemy"
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
