import { Head, Link } from "@inertiajs/react"
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  Mail,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Zap,
} from "lucide-react"

import { CodeBlock, GlowCard, Overline, SectionHeading, StatusDot } from "@/components/brand"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { Button } from "@/components/ui/button"
import { newUserRegistrationPath } from "@/routes"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title="Alchemy — AI employees that live inside your tools" />
      <LandingNav />

      <Hero />
      <LogoCloud />
      <PlatformSection />
      <AgentRoster />
      <HowItWorks />
      <IntegrationsSection />
      <Testimonial />
      <PricingTease />
      <FinalCTA />

      <LandingFooter />
    </div>
  )
}

/* ============================================================
   HERO
   ============================================================ */
function Hero() {
  return (
    <section className="relative overflow-hidden border-b">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 gradient-hero opacity-70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade"
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 pb-20 pt-20 md:pb-28 md:pt-28">
        <div className="flex flex-col items-start gap-8">
          <a
            href="#changelog"
            className="group inline-flex items-center gap-2 rounded-full border border-[var(--cyan-border)] bg-[var(--cyan-surface)] px-3.5 py-1.5 text-xs font-medium text-foreground backdrop-blur transition-all hover:border-[var(--cyan)]"
          >
            <span className="overline text-[var(--cyan)]">New</span>
            <span className="h-3 w-px bg-[var(--cyan-border)]" />
            <span>Autonomous scheduling + Slack channels</span>
            <ArrowUpRight className="size-3 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>

          <h1 className="text-hero max-w-5xl text-foreground">
            Hire an AI employee.
            <br />
            Let it <span className="cyan-mark">work</span> where your team already does.
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Alchemy agents live in email, Slack, SMS, and your CRM — running real work
            on a schedule, routing approvals to you, and leaving an audit trail for every
            token and tool call.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button asChild size="lg" className="h-11 gap-1.5 px-5 text-sm">
              <Link href={newUserRegistrationPath()}>
                Start free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 gap-1.5 px-5 text-sm">
              <a href="#demo">Watch a 90-sec demo</a>
            </Button>
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              No credit card · SOC 2 in progress
            </span>
          </div>
        </div>

        <HeroPreview />
      </div>
    </section>
  )
}

function HeroPreview() {
  return (
    <div className="relative mt-20 md:mt-24">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10 opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 40%, var(--indigo-glow) 0%, transparent 60%), radial-gradient(40% 40% at 80% 20%, var(--cyan-glow) 0%, transparent 60%)",
        }}
      />
      <GlowCard
        glow="strong"
        tint="indigo"
        className="overflow-hidden"
        brutalist
      >
        <div className="flex items-center justify-between border-b bg-[var(--muted)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#ff5f56]" />
            <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="size-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-3 font-mono text-[11px] text-muted-foreground">
              app.alchemy.ai/agents/alex
            </span>
          </div>
          <StatusDot status="working" pulse />
        </div>

        <div className="grid grid-cols-12 gap-0">
          {/* Left rail */}
          <div className="col-span-3 border-r p-4">
            <div className="space-y-1">
              <div className="rounded-md bg-[var(--indigo-surface)] px-3 py-2 text-[13px] font-medium text-foreground">
                <span className="inline-flex items-center gap-2">
                  <Bot className="size-3.5 text-[var(--color-indigo)]" />
                  Alex (SDR)
                </span>
              </div>
              <div className="px-3 py-2 text-[13px] text-muted-foreground">Morgan (Ops)</div>
              <div className="px-3 py-2 text-[13px] text-muted-foreground">Jamie (Support)</div>
              <div className="px-3 py-2 text-[13px] text-muted-foreground">Riley (Analyst)</div>
            </div>
          </div>

          {/* Main */}
          <div className="col-span-6 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Overline dot accent>Running</Overline>
                <h3 className="mt-2 text-lg font-semibold text-foreground">Alex — outbound SDR</h3>
                <p className="text-sm text-muted-foreground">
                  Qualifying inbound MQLs, sending sequenced email, logging to Salesforce.
                </p>
              </div>
              <span className="rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                GPT-5
              </span>
            </div>

            <div className="mt-5 space-y-2">
              {[
                {
                  icon: <Mail className="size-3.5" />,
                  text: "Sent intro email to Priya Shah (Acme Co)",
                  meta: "2s ago",
                },
                {
                  icon: <CheckCircle2 className="size-3.5" />,
                  text: "Logged contact in Salesforce",
                  meta: "14s ago",
                },
                {
                  icon: <MessageSquare className="size-3.5" />,
                  text: "Replied to Slack #inbound thread",
                  meta: "41s ago",
                },
                {
                  icon: <ShieldCheck className="size-3.5" />,
                  text: "Awaiting approval — discount > 15%",
                  meta: "1m ago",
                  warn: true,
                },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-[13px] hover:border-[var(--border)] hover:bg-[var(--muted)]"
                >
                  <span className="flex items-center gap-2.5 text-foreground">
                    <span
                      className={
                        row.warn
                          ? "text-[var(--color-warning)]"
                          : "text-[var(--color-success)]"
                      }
                    >
                      {row.icon}
                    </span>
                    {row.text}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{row.meta}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right rail — metrics */}
          <div className="col-span-3 space-y-4 border-l bg-[var(--secondary)] p-5">
            <div>
              <Overline>Today</Overline>
              <div className="mt-2 text-3xl font-semibold text-foreground">142</div>
              <div className="font-mono text-[11px] text-muted-foreground">tool calls</div>
            </div>
            <div>
              <Overline>Pipeline</Overline>
              <div className="mt-2 text-3xl font-semibold text-[var(--color-success)]">+$48k</div>
              <div className="font-mono text-[11px] text-muted-foreground">this week</div>
            </div>
            <div>
              <Overline>Cost</Overline>
              <div className="mt-2 text-3xl font-semibold text-foreground">$3.14</div>
              <div className="font-mono text-[11px] text-muted-foreground">today · within budget</div>
            </div>
          </div>
        </div>
      </GlowCard>
    </div>
  )
}

/* ============================================================
   LOGO CLOUD
   ============================================================ */
function LogoCloud() {
  const logos = [
    "Salesforce",
    "HubSpot",
    "Slack",
    "Notion",
    "Linear",
    "Gmail",
    "Stripe",
    "Intercom",
    "Zendesk",
    "Twilio",
    "Shopify",
    "Segment",
  ]

  return (
    <section className="border-b bg-background py-10">
      <div className="mx-auto w-full max-w-7xl px-6">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Agents work inside the tools you already pay for
        </p>
        <div className="relative mt-6 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent"
          />
          <div className="flex w-max animate-marquee items-center gap-14 pr-14">
            {[...logos, ...logos].map((name, i) => (
              <span
                key={i}
                className="whitespace-nowrap font-display text-xl font-medium tracking-tight text-muted-foreground/70 transition-colors hover:text-foreground"
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

/* ============================================================
   PLATFORM
   ============================================================ */
function PlatformSection() {
  const cards = [
    {
      icon: Bot,
      title: "Deploy specialized agents",
      body: "Roles, skills, schedules. Each agent has a distinct job and its own memory, budget, and approvals policy.",
    },
    {
      icon: Plug,
      title: "Native tool connections",
      body: "OAuth into Slack, Salesforce, Gmail, Notion, Linear, and 40+ more. Agents use tools, not scrapers.",
    },
    {
      icon: ShieldCheck,
      title: "Approvals, not autonomy",
      body: "Set policy — discounts, deletions, outbound. Humans approve the moments that matter.",
    },
    {
      icon: Gauge,
      title: "Observability by default",
      body: "Token-level run traces, cost per agent, tool-call trees, replayable transcripts.",
    },
    {
      icon: Database,
      title: "Knowledge that sticks",
      body: "Upload docs, connect a drive. Agents retrieve answers with citations, not hallucinations.",
    },
    {
      icon: Zap,
      title: "Schedules + events",
      body: "Cron triggers, webhook triggers, inbound email. Your agent wakes up when work arrives.",
    },
  ]

  return (
    <section id="platform" className="relative border-b py-24 md:py-32">
      <div className="mx-auto w-full max-w-7xl px-6">
        <SectionHeading
          eyebrow="Platform"
          title={
            <>
              Everything an AI teammate needs <span className="cyan-mark">to actually ship</span> work.
            </>
          }
          description="A control plane for AI employees. Built on the primitives you'd build yourself — if you had six months."
        />

        <div className="mt-14 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => (
            <div
              key={card.title}
              className="group relative flex flex-col gap-4 rounded-lg border bg-card p-6 transition-all hover:border-[var(--border-strong)]"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-md border border-[var(--indigo-border)] bg-[var(--indigo-surface)] text-[var(--color-indigo)] transition-colors group-hover:border-[var(--color-indigo)]">
                  <card.icon className="size-4" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                  {card.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {card.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   AGENT ROSTER
   ============================================================ */
function AgentRoster() {
  const agents = [
    {
      name: "Alex",
      role: "SDR",
      tag: "Sales",
      blurb: "Qualifies inbound, sequences outbound, logs to CRM.",
      metric: "142 replies / week",
      tone: "indigo" as const,
    },
    {
      name: "Morgan",
      role: "Ops",
      tag: "Revenue ops",
      blurb: "Reconciles Stripe → QuickBooks, flags anomalies in Slack.",
      metric: "6hr / wk saved",
      tone: "cyan" as const,
    },
    {
      name: "Jamie",
      role: "Support triage",
      tag: "CX",
      blurb: "Labels tickets, writes drafts, escalates by policy.",
      metric: "38% first-touch",
      tone: "indigo" as const,
    },
    {
      name: "Riley",
      role: "Analyst",
      tag: "Data",
      blurb: "Writes weekly reports. Queries Postgres, cites sources.",
      metric: "Mondays at 9:00",
      tone: "cyan" as const,
    },
  ]

  return (
    <section id="agents" className="relative overflow-hidden border-b py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid opacity-50 bg-dot-grid-fade"
      />
      <div className="relative mx-auto w-full max-w-7xl px-6">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <SectionHeading
            eyebrow="Roster"
            title="Pre-built agents. Shipped Monday."
            description="Start with a proven template, tune the policy, plug in tools. Or build from scratch with the SDK."
          />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="#all-agents">
              Browse all templates <ArrowRight className="size-3.5" />
            </a>
          </Button>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {agents.map((agent) => (
            <GlowCard key={agent.name} glow="soft" tint={agent.tone} className="p-5">
              <div className="flex items-start justify-between">
                <div
                  className="flex size-10 items-center justify-center rounded-md border font-display text-sm font-semibold"
                  style={{
                    borderColor:
                      agent.tone === "cyan" ? "var(--cyan-border)" : "var(--indigo-border)",
                    background:
                      agent.tone === "cyan" ? "var(--cyan-surface)" : "var(--indigo-surface)",
                    color: "var(--foreground)",
                  }}
                >
                  {agent.name[0]}
                </div>
                <span className="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {agent.tag}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                {agent.name}{" "}
                <span className="font-normal text-muted-foreground">· {agent.role}</span>
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {agent.blurb}
              </p>
              <div className="mt-5 flex items-center justify-between border-t pt-3">
                <span className="font-mono text-[11px] text-muted-foreground">{agent.metric}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </div>
            </GlowCard>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   HOW IT WORKS — split with code preview
   ============================================================ */
function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Pick a role",
      body: "Choose an agent template or start blank. Name it. Give it a goal.",
    },
    {
      n: "02",
      title: "Plug in tools",
      body: "OAuth the services it should use. Upload docs it should know.",
    },
    {
      n: "03",
      title: "Set policy",
      body: "What it can do on its own, what needs your approval, what's off-limits.",
    },
    {
      n: "04",
      title: "Ship",
      body: "Schedule it, trigger it, or let it wake up when email lands.",
    },
  ]

  return (
    <section className="relative border-b py-24 md:py-32">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHeading
            eyebrow="How it works"
            title="Four steps from idea to agent on-call."
            description="No MLOps. No prompt engineering PhD. Pick, plug, police, ship."
          />

          <ol className="mt-10 space-y-0 border-t">
            {steps.map((step) => (
              <li key={step.n} className="group flex items-start gap-5 border-b py-5">
                <span className="font-mono text-xs text-muted-foreground">{step.n}</span>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground">{step.body}</p>
                </div>
                <ArrowRight className="mt-1 size-4 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-[var(--color-indigo)]" />
              </li>
            ))}
          </ol>
        </div>

        <div className="lg:col-span-7">
          <div className="sticky top-24 space-y-3">
            <Overline dot accent>
              <span className="font-mono">alchemy.config.ts</span>
            </Overline>
            <CodeBlock filename="alex.agent.ts" language="typescript">
{`import { defineAgent } from "@alchemy/core"
import { slack, salesforce, gmail } from "@alchemy/tools"

export const alex = defineAgent({
  name: "Alex",
  role: "SDR",
  model: "gpt-5",

  goal: \`Qualify inbound MQLs, send sequenced outreach,
         and log every touch to Salesforce.\`,

  tools: [gmail, slack, salesforce],

  policy: {
    autoApprove: ["send_email", "log_contact"],
    requireApproval: ["offer_discount", "refund"],
    budget: { daily: 5.00, unit: "usd" },
  },

  schedule: "every weekday at 9:00 America/Los_Angeles",
})`}
            </CodeBlock>

            <div className="grid grid-cols-3 gap-2 pt-2">
              {[
                { icon: Clock, label: "Auto-trigger", value: "9:00 AM" },
                { icon: Cpu, label: "Model", value: "gpt-5" },
                { icon: Sparkles, label: "Status", value: "Live" },
              ].map((m) => (
                <div
                  key={m.label}
                  className="flex items-center gap-2.5 rounded-md border bg-card px-3 py-2.5"
                >
                  <m.icon className="size-3.5 text-[var(--color-indigo)]" />
                  <div className="flex flex-col">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {m.label}
                    </span>
                    <span className="text-[13px] font-medium text-foreground">{m.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   INTEGRATIONS
   ============================================================ */
function IntegrationsSection() {
  const integrations = [
    { name: "Slack", tag: "Messaging" },
    { name: "Salesforce", tag: "CRM" },
    { name: "Gmail", tag: "Email" },
    { name: "HubSpot", tag: "CRM" },
    { name: "Notion", tag: "Docs" },
    { name: "Linear", tag: "Issues" },
    { name: "Stripe", tag: "Payments" },
    { name: "Twilio", tag: "SMS" },
    { name: "Intercom", tag: "Support" },
    { name: "Zendesk", tag: "Support" },
    { name: "Shopify", tag: "Commerce" },
    { name: "Segment", tag: "Data" },
  ]

  return (
    <section id="integrations" className="border-b py-24 md:py-32">
      <div className="mx-auto w-full max-w-7xl px-6">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <SectionHeading
            eyebrow="Integrations"
            title="Your stack, wired to an agent in one click."
          />
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <a href="#all-integrations">
              See all 40+ <ArrowRight className="size-3.5" />
            </a>
          </Button>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--border)] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {integrations.map((i) => (
            <div
              key={i.name}
              className="group flex aspect-square flex-col items-center justify-center gap-2 bg-card p-4 transition-colors hover:bg-[var(--muted)]"
            >
              <div className="flex size-10 items-center justify-center rounded-md border bg-background font-display text-sm font-semibold">
                {i.name[0]}
              </div>
              <span className="text-[13px] font-medium text-foreground">{i.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {i.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   TESTIMONIAL
   ============================================================ */
function Testimonial() {
  return (
    <section className="relative overflow-hidden border-b py-24 md:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(40% 50% at 20% 50%, var(--indigo-glow) 0%, transparent 60%), radial-gradient(40% 50% at 80% 50%, var(--cyan-glow) 0%, transparent 60%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-4xl px-6 text-center">
        <Overline accent dot>Case study · Acme</Overline>
        <blockquote className="mt-8 font-display text-3xl font-medium leading-[1.15] tracking-tight text-foreground md:text-5xl">
          "We hired Alex on a Thursday. By Monday morning it had touched 400 leads,
          logged every conversation, and flagged three enterprise deals for us."
        </blockquote>
        <div className="mt-10 flex items-center justify-center gap-4">
          <div className="size-10 rounded-full border bg-[var(--indigo-surface)]" />
          <div className="text-left">
            <div className="text-sm font-semibold text-foreground">Priya Shah</div>
            <div className="font-mono text-xs text-muted-foreground">Head of Growth · Acme</div>
          </div>
        </div>

        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-lg border bg-[var(--border)]">
          {[
            { v: "400+", l: "leads touched · week 1" },
            { v: "6×", l: "reply volume vs. manual" },
            { v: "$312", l: "spent, not $30k" },
          ].map((s) => (
            <div key={s.l} className="flex flex-col items-center gap-1 bg-background p-6">
              <span className="font-display text-3xl font-semibold tracking-tight text-foreground">
                {s.v}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {s.l}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   PRICING TEASE
   ============================================================ */
function PricingTease() {
  const tiers = [
    {
      name: "Starter",
      price: "$49",
      unit: "/ agent / mo",
      bullets: ["1 agent", "Basic tools", "Community support", "7-day traces"],
      highlight: false,
    },
    {
      name: "Team",
      price: "$199",
      unit: "/ agent / mo",
      bullets: [
        "Unlimited agents",
        "All 40+ integrations",
        "Approvals + audit log",
        "90-day traces",
      ],
      highlight: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      unit: "",
      bullets: ["SSO + SCIM", "Dedicated infra", "SLA + priority support", "Unlimited traces"],
      highlight: false,
    },
  ]

  return (
    <section id="pricing" className="border-b py-24 md:py-32">
      <div className="mx-auto w-full max-w-7xl px-6">
        <SectionHeading
          eyebrow="Pricing"
          align="center"
          title="Pay per agent. Not per seat."
          description="Every plan includes the full observability stack — traces, costs, and policy enforcement."
        />

        <div className="mx-auto mt-14 grid max-w-5xl gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-lg border p-8 transition-all ${
                t.highlight
                  ? "border-[var(--color-indigo)] bg-[var(--indigo-surface)]/40 shadow-brutalist"
                  : "bg-card"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-8 rounded-sm bg-[var(--color-indigo)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
                  Most popular
                </span>
              )}
              <span className="text-eyebrow">{t.name}</span>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold tracking-tight text-foreground">
                  {t.price}
                </span>
                {t.unit && (
                  <span className="font-mono text-xs text-muted-foreground">{t.unit}</span>
                )}
              </div>
              <ul className="mt-6 space-y-2.5 border-t pt-6">
                {t.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[13px] text-foreground">
                    <CheckCircle2
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        t.highlight ? "text-[var(--color-indigo)]" : "text-[var(--cyan)]"
                      }`}
                    />
                    {b}
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-8"
                variant={t.highlight ? "default" : "outline"}
              >
                <Link href={newUserRegistrationPath()}>
                  {t.name === "Enterprise" ? "Contact sales" : "Start free"}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================
   FINAL CTA
   ============================================================ */
function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 gradient-hero opacity-80"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid-fade opacity-60"
      />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 text-center">
        <Overline accent dot>Ready in 90 seconds</Overline>
        <h2 className="text-hero text-foreground">
          Hire your first agent.
          <br />
          <span className="cyan-mark">On us</span>, for 14 days.
        </h2>
        <p className="max-w-xl text-base text-muted-foreground">
          Alex is waiting. Plug in Slack and Salesforce, approve your first outbound —
          and go do something more interesting than inbox triage.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 gap-1.5 px-6">
            <Link href={newUserRegistrationPath()}>
              Start free <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 gap-1.5 px-6">
            <a href="#docs">
              <TerminalSquare className="size-4" /> Read the docs
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}
