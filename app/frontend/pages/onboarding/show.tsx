import { Head, router } from "@inertiajs/react"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Briefcase,
  Check,
  Code,
  Cpu,
  Layers,
  RefreshCw,
  Search,
  Shield,
  SkipForward,
  Sparkles,
  Swords,
  Target,
  Users,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import AppLogo from "@/components/app-logo"
import { Overline } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  onboardingAnalyzePath,
  onboardingCompletePath,
  onboardingSkipPath,
  onboardingStatusPath,
} from "@/routes"

interface Props {
  organization: {
    id: number
    name: string
    slug: string
    website_url: string | null
    company_summary: string | null
    onboarding_completed_at: string | null
  }
  suggested_website: string | null
}

type Step = "website" | "analyzing" | "summary" | "error" | "agents"

interface CompanySummary {
  summary: string
  industry: string
  target_audience: string
  products: string[]
  differentiators: string[]
  tech_stack: string[]
  competitors: string[]
}

function parseSummary(raw: string): CompanySummary | null {
  try {
    const data = JSON.parse(raw)
    if (data.summary) return data as CompanySummary
  } catch {
    // Not JSON — legacy plain text
  }
  return null
}

function SummaryLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function TagList({ items, color }: { items: string[]; color?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
          style={color ? { borderColor: `${color}40`, color, background: `${color}10` } : {}}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

const AGENTS = [
  {
    name: "CEO",
    role: "Chief Executive Officer",
    icon: Briefcase,
    color: "var(--color-indigo)",
    description: "Oversees strategy, delegates tasks, coordinates the team",
  },
  {
    name: "Marketing Manager",
    role: "Marketing Manager",
    icon: Users,
    color: "var(--cyan)",
    description: "Content strategy, campaigns, brand messaging, growth",
  },
  {
    name: "Software Engineer",
    role: "Software Engineer",
    icon: Code,
    color: "#a78bfa",
    description: "Builds and maintains technical systems and architecture",
  },
  {
    name: "SEO Specialist",
    role: "SEO Specialist",
    icon: Search,
    color: "#34d399",
    description: "Optimizes search rankings and drives organic traffic",
  },
]

// Animated dots for the analyzing phase
function PulsingOrb() {
  return (
    <div className="relative mx-auto my-8 flex h-32 w-32 items-center justify-center">
      {/* Outer glow rings */}
      <div className="absolute inset-0 animate-ping rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, var(--cyan) 0%, transparent 70%)", animationDuration: "2s" }}
      />
      <div className="absolute inset-4 animate-ping rounded-full opacity-30"
        style={{ background: "radial-gradient(circle, var(--color-indigo) 0%, transparent 70%)", animationDuration: "1.5s", animationDelay: "0.3s" }}
      />
      {/* Core orb */}
      <div
        className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
        style={{
          background: "linear-gradient(135deg, var(--color-indigo) 0%, var(--cyan) 100%)",
          boxShadow: "0 0 40px var(--cyan-glow), 0 0 80px var(--indigo-glow)",
        }}
      >
        <Sparkles className="size-7 animate-pulse text-white" />
      </div>
      {/* Orbiting particles */}
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: "4s" }}>
        <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: "var(--cyan)", boxShadow: "0 0 8px var(--cyan)" }} />
      </div>
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: "6s", animationDirection: "reverse" }}>
        <div className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ background: "var(--color-indigo)", boxShadow: "0 0 8px var(--color-indigo)" }} />
      </div>
    </div>
  )
}

// Animated text that cycles through analysis phases
function AnalysisStatus() {
  const phases = [
    "Connecting to website...",
    "Reading page content...",
    "Analyzing company profile...",
    "Identifying products & services...",
    "Generating company summary...",
  ]
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % phases.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  return (
    <p
      key={index}
      className="animate-fade-in text-center text-sm text-muted-foreground"
    >
      {phases[index]}
    </p>
  )
}

// Agent card that animates in with stagger
function AgentCard({
  agent,
  index,
  visible,
}: {
  agent: (typeof AGENTS)[number]
  index: number
  visible: boolean
}) {
  const Icon = agent.icon
  return (
    <div
      className="flex items-start gap-3 rounded-lg border bg-card p-4 transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transitionDelay: `${index * 150}ms`,
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: `${agent.color}18`, color: agent.color }}
      >
        <Icon className="size-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{agent.name}</p>
        <p className="text-xs text-muted-foreground">{agent.description}</p>
      </div>
    </div>
  )
}

// Hierarchy lines for the agent tree
function AgentTree({ visible }: { visible: boolean }) {
  return (
    <div className="space-y-3">
      {/* CEO at top */}
      <AgentCard agent={AGENTS[0]} index={0} visible={visible} />

      {/* Reports indented */}
      <div className="ml-6 space-y-3 border-l-2 border-dashed border-muted-foreground/20 pl-4">
        <AgentCard agent={AGENTS[1]} index={1} visible={visible} />
        <AgentCard agent={AGENTS[2]} index={2} visible={visible} />

        {/* SEO nested under Marketing */}
        <div className="ml-6 border-l-2 border-dashed border-muted-foreground/20 pl-4">
          <AgentCard agent={AGENTS[3]} index={3} visible={visible} />
        </div>
      </div>
    </div>
  )
}

export default function OnboardingShow({
  organization,
  suggested_website,
}: Props) {
  const [step, setStep] = useState<Step>(
    organization.company_summary ? "summary" : "website"
  )
  const [website, setWebsite] = useState(
    (organization.website_url || suggested_website || "").replace(/^https?:\/\//, "")
  )
  const [summary, setSummary] = useState(organization.company_summary || "")
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [agentsVisible, setAgentsVisible] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Poll for analysis completion
  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(onboardingStatusPath(), {
          headers: { Accept: "application/json" },
        })
        const data = await res.json()
        if (data.error) {
          stopPolling()
          setAnalysisError(data.error)
          setStep("error")
        } else if (data.company_summary) {
          stopPolling()
          setSummary(data.company_summary)
          setStep("summary")
        }
      } catch {
        // keep polling
      }
    }, 2000)
  }, [stopPolling])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  async function handleAnalyze(e?: React.FormEvent) {
    e?.preventDefault()
    if (!website.trim()) return
    setSubmitting(true)
    setAnalysisError(null)

    try {
      const csrfToken = document
        .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
        ?.getAttribute("content")

      await fetch(onboardingAnalyzePath(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify({ website_url: `https://${website.replace(/^https?:\/\//, "")}` }),
      })
      setStep("analyzing")
      startPolling()
    } catch {
      // Fallback
    } finally {
      setSubmitting(false)
    }
  }

  function handleRetry() {
    handleAnalyze()
  }

  function handleBackToWebsite() {
    setAnalysisError(null)
    setStep("website")
  }

  function handleShowAgents() {
    setStep("agents")
    // Stagger agent cards in
    setTimeout(() => setAgentsVisible(true), 100)
  }

  function handleComplete() {
    setSubmitting(true)
    router.post(onboardingCompletePath())
  }

  function handleSkip() {
    router.post(onboardingSkipPath())
  }

  return (
    <>
      <Head title="Set up your workspace" />

      <div className="flex min-h-screen bg-background">
        {/* Left: Brand panel (same style as auth) */}
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
            <AppLogo size="lg" />
          </div>

          <div className="relative space-y-6">
            <Overline accent dot>
              Onboarding
            </Overline>
            <h1 className="font-display text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-foreground md:text-5xl">
              Let's build your
              <br />
              <span className="cyan-mark">AI team.</span>
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
              We'll analyze your company and generate a starter team of AI
              agents tailored to your business.
            </p>

            {/* Step indicators */}
            <div className="max-w-xs space-y-3 pt-4">
              {[
                { key: "website", label: "Company website" },
                { key: "analyzing", label: "AI analysis" },
                { key: "agents", label: "Meet your team" },
              ].map((s, i) => {
                const steps: Step[] = ["website", "analyzing", "summary", "agents"]
                const currentIdx = steps.indexOf(step)
                const stepIdx = i === 2 ? 3 : i // "agents" is index 3
                const isError = step === "error" && s.key === "analyzing"
                const isDone = !isError && (currentIdx > stepIdx || (s.key === "analyzing" && (step === "summary" || step === "agents")))
                const isCurrent = s.key === step || (s.key === "analyzing" && (step === "summary" || step === "error"))

                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-all duration-300"
                      style={{
                        background: isError
                          ? "var(--destructive)"
                          : isDone
                          ? "var(--cyan)"
                          : isCurrent
                            ? "var(--color-indigo)"
                            : "transparent",
                        color: isError || isDone || isCurrent ? "white" : "var(--muted-foreground)",
                        border:
                          isDone || isCurrent
                            ? "none"
                            : "1.5px solid var(--border)",
                      }}
                    >
                      {isError ? "!" : isDone ? <Check className="size-3.5" /> : i + 1}
                    </div>
                    <span
                      className={`text-sm transition-colors ${isCurrent ? "font-medium text-foreground" : "text-muted-foreground"}`}
                    >
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="relative font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Alchemy · Turn effort into outcome
          </p>
        </aside>

        {/* Right: Content panel */}
        <main className="flex w-full items-center justify-center p-6 sm:p-10 lg:w-1/2">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="mb-10 lg:hidden">
              <AppLogo />
            </div>

            {/* Step: Website URL */}
            {step === "website" && (
              <div className="animate-fade-in space-y-6">
                <div className="space-y-2">
                  <Overline>Step 1</Overline>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">
                    What's your company website?
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    We'll analyze your site to understand your business and
                    create tailored AI agents.
                  </p>
                </div>

                <form onSubmit={handleAnalyze} className="space-y-4">
                  <div className="flex h-11 items-center rounded-md border bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    <span className="flex h-full shrink-0 items-center border-r bg-muted/50 pl-3 pr-2 text-sm text-muted-foreground">
                      https://
                    </span>
                    <input
                      type="text"
                      placeholder="yourcompany.com"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value.replace(/^https?:\/\//, ""))}
                      required
                      autoFocus
                      className="h-full w-full bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="h-10 w-full gap-1.5"
                    disabled={submitting || !website.trim()}
                  >
                    {submitting ? (
                      "Connecting..."
                    ) : (
                      <>
                        Analyze my site <ArrowRight className="size-3.5" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="border-t pt-4">
                  <button
                    onClick={handleSkip}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <SkipForward className="size-3.5" />
                    Skip setup for now
                  </button>
                </div>
              </div>
            )}

            {/* Step: Analyzing */}
            {step === "analyzing" && (
              <div className="animate-fade-in space-y-4 text-center">
                <Overline>Step 2</Overline>
                <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">
                  Analyzing your company
                </h2>

                <PulsingOrb />
                <AnalysisStatus />

                <p className="text-xs text-muted-foreground/60">
                  This usually takes 10-20 seconds
                </p>

                <div className="border-t pt-4">
                  <button
                    onClick={handleSkip}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <SkipForward className="size-3.5" />
                    Skip and continue manually
                  </button>
                </div>
              </div>
            )}

            {/* Step: Error */}
            {step === "error" && (
              <div className="animate-fade-in space-y-6">
                <div className="space-y-2">
                  <Overline>Analysis failed</Overline>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">
                    Something went wrong
                  </h2>
                </div>

                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="size-4 text-destructive" />
                    <span className="text-sm font-medium text-destructive">
                      Could not analyze website
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {analysisError}
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleRetry}
                    className="h-10 flex-1 gap-1.5"
                    disabled={submitting}
                  >
                    <RefreshCw className="size-3.5" />
                    {submitting ? "Retrying..." : "Try again"}
                  </Button>
                  <Button
                    onClick={handleBackToWebsite}
                    variant="outline"
                    className="h-10 flex-1"
                  >
                    Change URL
                  </Button>
                </div>

                <div className="border-t pt-4">
                  <button
                    onClick={handleSkip}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <SkipForward className="size-3.5" />
                    Skip setup for now
                  </button>
                </div>
              </div>
            )}

            {/* Step: Summary ready */}
            {step === "summary" && (() => {
              const parsed = parseSummary(summary)
              return (
                <div className="animate-fade-in space-y-5">
                  <div className="space-y-2">
                    <Overline>Step 2</Overline>
                    <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">
                      Here's what we found
                    </h2>
                  </div>

                  {parsed ? (
                    <div className="space-y-4">
                      {/* Summary + Industry */}
                      <div className="rounded-lg border bg-card p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ background: "linear-gradient(135deg, var(--color-indigo) 0%, var(--cyan) 100%)" }}
                          >
                            <Sparkles className="size-3 text-white" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            {parsed.industry}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-foreground">
                          {parsed.summary}
                        </p>
                      </div>

                      {/* Target audience */}
                      <div className="rounded-lg border bg-card p-3">
                        <SummaryLabel icon={Target} label="Target Audience" />
                        <p className="text-sm text-foreground">{parsed.target_audience}</p>
                      </div>

                      {/* Products */}
                      {parsed.products?.length > 0 && (
                        <div className="rounded-lg border bg-card p-3">
                          <SummaryLabel icon={Layers} label="Products & Services" />
                          <TagList items={parsed.products} color="var(--color-indigo)" />
                        </div>
                      )}

                      {/* Tech Stack */}
                      {parsed.tech_stack?.length > 0 && parsed.tech_stack[0] !== "Unknown" && (
                        <div className="rounded-lg border bg-card p-3">
                          <SummaryLabel icon={Cpu} label="Tech Stack" />
                          <TagList items={parsed.tech_stack} color="var(--cyan)" />
                        </div>
                      )}

                      {/* Differentiators */}
                      {parsed.differentiators?.length > 0 && (
                        <div className="rounded-lg border bg-card p-3">
                          <SummaryLabel icon={Shield} label="Differentiators" />
                          <ul className="space-y-1">
                            {parsed.differentiators.map((d) => (
                              <li key={d} className="flex items-start gap-2 text-sm text-foreground">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                                {d}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Competitors */}
                      {parsed.competitors?.length > 0 && (
                        <div className="rounded-lg border bg-card p-3">
                          <SummaryLabel icon={Swords} label="Competitors" />
                          <TagList items={parsed.competitors} />
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Fallback for plain text */
                    <div className="rounded-lg border bg-card p-4">
                      <p className="text-sm leading-relaxed text-foreground">{summary}</p>
                    </div>
                  )}

                  <Button
                    onClick={handleShowAgents}
                    className="h-10 w-full gap-1.5"
                  >
                    Generate my AI team <Bot className="size-3.5" />
                  </Button>

                  <div className="border-t pt-4">
                    <button
                      onClick={handleSkip}
                      className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <SkipForward className="size-3.5" />
                      Skip for now
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Step: Agent preview */}
            {step === "agents" && (
              <div className="animate-fade-in space-y-6">
                <div className="space-y-2">
                  <Overline>Step 3</Overline>
                  <h2 className="font-display text-2xl font-semibold tracking-[-0.025em] text-foreground">
                    Meet your AI team
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    These agents will be created with your company context
                    built in. You can customize them later.
                  </p>
                </div>

                <AgentTree visible={agentsVisible} />

                <Button
                  onClick={handleComplete}
                  className="h-10 w-full gap-1.5"
                  disabled={submitting}
                >
                  {submitting ? (
                    "Creating agents..."
                  ) : (
                    <>
                      Create team & go to dashboard{" "}
                      <ArrowRight className="size-3.5" />
                    </>
                  )}
                </Button>

                <div className="border-t pt-4">
                  <button
                    onClick={handleSkip}
                    className="flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <SkipForward className="size-3.5" />
                    Skip — I'll create agents myself
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
