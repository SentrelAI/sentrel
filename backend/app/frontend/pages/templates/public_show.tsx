import { Head, Link } from "@inertiajs/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CalendarClock,
  Cpu,
  GitBranch,
  Image as ImageIcon,
  ListChecks,
  Plug,
  Rocket,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Overline } from "@/components/brand"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { RobotCharacter } from "@/components/robot-character"
import { deployHref } from "@/components/template-deploy-card"
import { MODELS_BY_PROVIDER } from "@/lib/model-catalog"

interface Template {
  slug: string
  name: string
  role: string
  description: string | null
  system_template: boolean
  author_name?: string
  install_count?: number
  identity_md: string | null
  personality_md: string | null
  instructions_md: string | null
  integrations: Integration[]
  capabilities: string[]
  skills: { slug: string; name: string }[]
  suggested_model: string | null
  suggested_provider: string | null
  source_url?: string | null
}

interface Integration {
  slug: string
  label: string
  logo?: string | null
}

// Built-in capability tool groups → friendly label + icon.
const CAPABILITY_META: Record<string, { label: string; icon: LucideIcon }> = {
  knowledge_base: { label: "Knowledge base", icon: BookOpen },
  scheduling: { label: "Scheduling", icon: CalendarClock },
  tasks: { label: "Tasks", icon: ListChecks },
  integrations: { label: "Integrations", icon: Plug },
  recall: { label: "Memory & recall", icon: Brain },
  send_media: { label: "Send media", icon: ImageIcon },
}

function modelLabel(value: string | null): string | null {
  if (!value) return null
  for (const list of Object.values(MODELS_BY_PROVIDER)) {
    const hit = list.find((m) => m.value === value)
    if (hit) return hit.label
  }
  return value
}

function prettySlug(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// The Sentrel wordmark — a gradient glyph + General Sans wordmark. Reused so
// the brand shows up consistently across the page (and any screenshot of it).
function SentrelWordmark({ className, prefix }: { className?: string; prefix?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {prefix && <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{prefix}</span>}
      <span
        aria-hidden
        className="grid size-5 place-items-center rounded-[6px] bg-gradient-to-br from-[var(--color-indigo)] to-[var(--cyan)] text-background shadow-sm"
      >
        <Sparkles className="size-3" />
      </span>
      <span className="font-display text-sm font-semibold tracking-[-0.03em] text-foreground">Sentrel</span>
    </span>
  )
}

// App chip — catalog logo on a white tile (so dark brand marks stay visible in
// dark mode), falling back to a colored monogram when no logo is set.
function AppChip({ app }: { app: Integration }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border bg-card py-1.5 pl-1.5 pr-3 text-sm font-medium">
      {app.logo ? (
        <span className="flex size-7 items-center justify-center rounded-md bg-white ring-1 ring-black/5">
          <img src={app.logo} alt="" className="size-4 object-contain" />
        </span>
      ) : (
        <span className="flex size-7 items-center justify-center rounded-md bg-foreground/10 text-[11px] font-bold uppercase text-foreground/70">
          {app.label.charAt(0)}
        </span>
      )}
      {app.label}
    </span>
  )
}

function RailHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h3>
  )
}

export default function TemplatePublicShow({ template: t }: { template: Template }) {
  const model = modelLabel(t.suggested_model)
  const sections = [
    { label: "Identity", body: t.identity_md },
    { label: "Personality", body: t.personality_md },
    { label: "How it works", body: t.instructions_md },
  ].filter((s) => s.body && s.body.trim().length > 0)

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Head title={`${t.name} · Agent template`} />
      <LandingNav />

      {/* Hero — reads like a poster/ad for the agent */}
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(45% 55% at 18% 25%, var(--cyan-glow) 0%, transparent 60%), radial-gradient(45% 55% at 85% 70%, var(--indigo-glow) 0%, transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-24 md:pb-20 md:pt-28">
          <div className="mb-10 flex items-center justify-between gap-4">
            <Link
              href="/templates"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              All templates
            </Link>
            <SentrelWordmark prefix="An AI agent by" />
          </div>

          <div className="flex flex-col items-center gap-10 md:flex-row md:items-center md:gap-16">
            <div className="relative shrink-0">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 rounded-full opacity-70 blur-2xl"
                style={{ background: "radial-gradient(closest-side, var(--indigo-glow) 0%, transparent 75%)" }}
              />
              <RobotCharacter seed={t.slug} size={248} className="relative drop-shadow-xl" />
            </div>

            <div className="flex-1 text-center md:text-left">
              <Overline accent dot>
                {t.system_template ? "System template" : "Community template"}
              </Overline>
              <h1 className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-[-0.03em] text-foreground md:text-7xl">
                {t.name}
              </h1>
              <p className="serif-italic mt-3 text-2xl leading-tight text-[var(--color-indigo)] md:text-3xl">
                {t.role}
              </p>
              {t.description && (
                <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:mx-0 md:text-base">
                  {t.description}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                {model && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
                    <Cpu className="size-3.5" />
                    {model}
                  </span>
                )}
                {t.author_name && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
                    by {t.author_name}
                  </span>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                <Button asChild size="lg" className="gap-2">
                  <a href={deployHref(t.slug)}>
                    <Rocket className="size-4" />
                    Deploy this agent
                  </a>
                </Button>
                {t.source_url && (
                  <Button asChild size="lg" variant="outline" className="gap-2">
                    <a href={t.source_url} target="_blank" rel="noreferrer">
                      <GitBranch className="size-4" />
                      View source
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Body — sticky "at a glance" rail + persona */}
      <section className="mx-auto w-full max-w-6xl px-6 py-14 md:py-16">
        <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-14">
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border bg-card/60 p-5">
              <Overline className="mb-4">At a glance</Overline>

              {model && (
                <div className="mb-5">
                  <RailHeading icon={Cpu}>Model</RailHeading>
                  <span className="text-sm text-foreground">{model}</span>
                </div>
              )}

              {t.integrations.length > 0 && (
                <div className="mb-5">
                  <RailHeading icon={Plug}>Tools it connects to</RailHeading>
                  <div className="flex flex-wrap gap-2">
                    {t.integrations.map((app) => (
                      <AppChip key={app.slug} app={app} />
                    ))}
                  </div>
                </div>
              )}

              {t.skills.length > 0 && (
                <div className="mb-5">
                  <RailHeading icon={Wrench}>Skills</RailHeading>
                  <div className="flex flex-wrap gap-1.5">
                    {t.skills.map((s) => (
                      <Badge key={s.slug} variant="secondary" className="text-[11px] font-normal">
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {t.capabilities.length > 0 && (
                <div className={t.source_url ? "mb-5" : ""}>
                  <RailHeading icon={Sparkles}>Built-in</RailHeading>
                  <div className="flex flex-wrap gap-1.5">
                    {t.capabilities.map((key) => {
                      const meta = CAPABILITY_META[key]
                      const Icon = meta?.icon ?? Wrench
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs"
                        >
                          <Icon className="size-3.5 text-muted-foreground" />
                          {meta?.label ?? prettySlug(key)}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {t.source_url && (
                <a
                  href={t.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <GitBranch className="size-3.5" />
                  View this template's source
                </a>
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {sections.length > 0 ? (
              <div className="space-y-10">
                {sections.map((sec) => (
                  <section key={sec.label}>
                    <h2 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {sec.label}
                    </h2>
                    <article className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.body}</ReactMarkdown>
                    </article>
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This template doesn't have a written persona yet.</p>
            )}

            {/* Bottom CTA — branded "ad" card */}
            <div className="relative mt-14 overflow-hidden rounded-2xl border bg-card/60 p-8 text-center md:p-10">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-70"
                style={{
                  background:
                    "radial-gradient(60% 120% at 50% 0%, var(--indigo-glow) 0%, transparent 60%)",
                }}
              />
              <div className="relative flex flex-col items-center gap-4">
                <RobotCharacter seed={t.slug} size={84} />
                <div>
                  <p className="font-display text-2xl font-semibold tracking-[-0.02em]">
                    Put <span className="serif-italic text-[var(--color-indigo)]">{t.name}</span> to work.
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    Connect the tools, set the policy, and your new {t.role.toLowerCase()} starts working in a couple of clicks.
                  </p>
                </div>
                <Button asChild size="lg" className="mt-1 gap-2">
                  <a href={deployHref(t.slug)}>
                    <Rocket className="size-4" />
                    Deploy this agent
                  </a>
                </Button>
                <SentrelWordmark prefix="Built on" className="mt-2 opacity-80" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}
