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

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(40% 50% at 20% 30%, var(--cyan-glow) 0%, transparent 60%), radial-gradient(40% 50% at 80% 60%, var(--indigo-glow) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-5xl px-6 pb-12 pt-24 md:pb-16 md:pt-28">
          <Link
            href="/templates"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All templates
          </Link>

          <div className="flex flex-col items-center gap-8 md:flex-row md:items-start md:gap-12">
            <div className="shrink-0">
              <RobotCharacter seed={t.slug} size={220} className="drop-shadow-md" />
            </div>

            <div className="flex-1 text-center md:text-left">
              <Badge variant={t.system_template ? "secondary" : "outline"} className="gap-1 text-[11px]">
                {t.system_template ? <Sparkles className="size-3" /> : <Users className="size-3" />}
                {t.system_template ? "System template" : "Community template"}
              </Badge>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-0.025em] text-foreground md:text-5xl">
                {t.name}
              </h1>
              <p className="mt-1 text-lg text-muted-foreground">{t.role}</p>
              {t.description && (
                <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:mx-0">
                  {t.description}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                {model && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                    <Cpu className="size-3.5" />
                    {model}
                  </span>
                )}
                {t.author_name && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                    by {t.author_name}
                  </span>
                )}
              </div>

              <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
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

      {/* Body */}
      <section className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
        {t.integrations.length > 0 && (
          <div className="mb-10">
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Plug className="size-3.5" />
              Tools it connects to
            </h3>
            <div className="flex flex-wrap gap-2">
              {t.integrations.map((app) => (
                <AppChip key={app.slug} app={app} />
              ))}
            </div>
          </div>
        )}

        {(t.capabilities.length > 0 || t.skills.length > 0) && (
          <div className="mb-10 grid gap-6 sm:grid-cols-2">
            {t.capabilities.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Built-in capabilities
                </h3>
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
            {t.skills.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Wrench className="size-3.5" />
                  Skills
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {t.skills.map((s) => (
                    <Badge key={s.slug} variant="secondary" className="text-[11px] font-normal">
                      {s.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-10">
          {sections.map((sec) => (
            <section key={sec.label}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {sec.label}
              </h2>
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.body}</ReactMarkdown>
              </article>
            </section>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-14 flex flex-col items-center gap-4 rounded-xl border bg-card/50 p-8 text-center">
          <RobotCharacter seed={t.slug} size={80} />
          <div>
            <p className="font-display text-lg font-semibold">Put {t.name} to work.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Deploy in a couple of clicks — connect the tools, set the policy, and it starts working.
            </p>
          </div>
          <Button asChild size="lg" className="gap-2">
            <a href={deployHref(t.slug)}>
              <Rocket className="size-4" />
              Deploy this agent
            </a>
          </Button>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}
