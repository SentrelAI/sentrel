import { Head, useForm } from "@inertiajs/react"
import { useEffect, useState } from "react"
import * as icons from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentsPath } from "@/routes"
import { randomAgentName, slugify } from "@/lib/random-names"

interface Template {
  slug: string
  name: string
  role: string
  description: string
  icon: string
  capabilities: Record<string, { enabled?: boolean; [k: string]: unknown }>
  suggested_skill_slugs: string[]
  suggested_integrations?: string[]
  suggested_manager_role: string | null
  suggested_provider: string | null
  suggested_model: string | null
  variables: string[]
}

interface AgentSummary {
  id: string
  name: string
  slug: string
  role: string
}

interface Props {
  templates: Template[]
  agents: AgentSummary[]
  org_email_domain: string | null
}

interface DraftResponse {
  template_slug: string | null
  role: string | null
  skill_slugs: string[]
  capabilities: Record<string, { enabled?: boolean }>
  provider: string
  model_id: string
  name_suggestion: string | null
  reasoning: string | null
  // Set when no existing template was a strong fit and AgentDrafter
  // generated fresh identity/personality/instructions via Forge.
  identity_md: string | null
  personality_md: string | null
  instructions_md: string | null
  generated: boolean
}

interface ChannelChoice {
  channel_type: string
  config: Record<string, string>
}

const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-opus-4-7",            label: "Claude Opus 4.7",   hint: "strongest reasoning, slowest + priciest" },
    { value: "claude-opus-4-6",            label: "Claude Opus 4.6",   hint: "previous Opus, still excellent" },
    { value: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", hint: "recommended default — fast + smart" },
    { value: "claude-sonnet-4-20250514",   label: "Claude Sonnet 4",   hint: "stable earlier Sonnet" },
    { value: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  hint: "fastest + cheapest, good for background tasks" },
  ],
  openrouter: [
    { value: "moonshotai/kimi-k2.6",            label: "Kimi K2.6 (Moonshot)", hint: "top agentic tool use" },
    { value: "minimax/minimax-m2.7",            label: "MiniMax M2.7",         hint: "long-context reasoning" },
    { value: "minimax/minimax-m2.5",            label: "MiniMax M2.5",         hint: "cheaper MiniMax" },
    { value: "deepseek/deepseek-v4-pro",        label: "DeepSeek V4 Pro",      hint: "strong reasoning" },
    { value: "deepseek/deepseek-v4-flash",      label: "DeepSeek V4 Flash",    hint: "cheap + fast" },
    { value: "qwen/qwen3-max-thinking",         label: "Qwen 3 Max (thinking)", hint: "open reasoning generalist" },
    { value: "anthropic/claude-opus-4-7",       label: "Claude Opus 4.7 (via OR)" },
    { value: "anthropic/claude-sonnet-4-6",     label: "Claude Sonnet 4.6 (via OR)" },
    { value: "openai/gpt-5.5-pro",              label: "GPT-5.5 Pro (via OR)" },
    { value: "google/gemini-3.1-pro-preview",   label: "Gemini 3.1 Pro (via OR)" },
    { value: "x-ai/grok-4.20",                  label: "Grok 4.20 (via OR)" },
  ],
}

const CAPABILITIES: Array<{ key: string; label: string; description: string }> = [
  {
    key: "knowledge_base",
    label: "Knowledge base (RAG)",
    description:
      "Lets the agent search and cite your uploaded documents — contracts, playbooks, policies. Turns on automatically when you upload the first doc. Also lets the agent share personal docs to the org-shared library.",
  },
  {
    key: "scheduling",
    label: "Scheduling & reminders",
    description:
      "The agent can set reminders (\"remind me Friday at 2\") and schedule recurring work (\"every Monday 9am pull the report\"). Without this, the agent can only respond in-the-moment.",
  },
  {
    key: "tasks",
    label: "Tasks & delegation",
    description:
      "The agent can create tasks for itself, comment to log progress, and delegate to other agents in your org by role or slug. This is what enables the hire-a-team flow — a manager agent can farm work out to its reports, and they report back automatically when done.",
  },
  {
    key: "integrations",
    label: "Third-party integrations",
    description:
      "Composio-powered access to Gmail, Notion, Slack, GitHub, Google Sheets, and 250+ other apps you've connected at /integrations. Without this, the agent can't touch any external service.",
  },
  {
    key: "recall",
    label: "Conversation + activity history",
    description:
      "The agent can look back through older conversations (search_messages) and its own past actions like sent emails, errors, and tool calls (search_activity). Useful for agents that need long memory.",
  },
  {
    key: "send_media",
    label: "Send voice, images & files",
    description:
      "Beyond text replies, the agent can record a voice note (TTS), send an image, or attach a file — on whatever channel the conversation is happening (Telegram, WhatsApp, web chat). Doesn't affect text messaging, which is always on.",
  },
]

type Step = "intro" | "details"

export default function AgentNew({ templates, agents, org_email_domain }: Props) {
  // If the user arrived via /agents/new?template=<slug> (clicking Install
  // on a template page), skip the intro wizard entirely — they already
  // told us what they want by picking the template. Start them on the
  // details step with the template pre-filled.
  const initialStep: Step = (() => {
    if (typeof window === "undefined") return "intro"
    const slug = new URLSearchParams(window.location.search).get("template")
    return slug && templates.some((t) => t.slug === slug) ? "details" : "intro"
  })()
  const [step, setStep] = useState<Step>(initialStep)
  const [picked, setPicked] = useState<Template | null>(null)

  // Intro form state
  const [description, setDescription] = useState("")
  const [toolsPreference, setToolsPreference] = useState<"recommend" | "specify">("recommend")
  const [toolsDescription, setToolsDescription] = useState("")
  const [wantEmail, setWantEmail] = useState(true)
  const [wantTelegram, setWantTelegram] = useState(false)
  const [introName, setIntroName] = useState(() => randomAgentName())
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftReasoning, setDraftReasoning] = useState<string | null>(null)
  // True when AgentDrafter generated fresh identity/personality/instructions
  // because no existing template was a strong fit — drives the "AI-generated
  // identity" card on the details step.
  const [isGenerated, setIsGenerated] = useState(false)
  // 3-stage spinner stage shown during drafting — keeps the user oriented
  // on what's happening server-side (analyze → resolve skills → draft copy).
  const [draftStage, setDraftStage] = useState<0 | 1 | 2 | 3>(0)
  // Show/hide preview-vs-edit toggle per markdown field on the details step.
  const [editingField, setEditingField] = useState<"identity" | "personality" | "instructions" | null>(null)

  // Collapsible side panel on the intro step — lets users browse the
  // template marketplace without leaving the scratch wizard.
  const [showTemplatePanel, setShowTemplatePanel] = useState(false)
  const [templateSearch, setTemplateSearch] = useState("")
  const filteredTemplates = templateSearch.trim()
    ? templates.filter((t) =>
        [t.name, t.role, t.description].join(" ").toLowerCase().includes(templateSearch.trim().toLowerCase()),
      )
    : templates

  // Per-action permission gates. Brand-new agents start in DRAFT mode
  // for send_email — the helper text on the field says "Draft is safest
  // while you're getting a feel for how the agent behaves", and the
  // default should match. Users explicitly flip to "Auto" once they
  // trust the agent's outbound after a few drafts.
  const { data, setData, post, processing, transform } = useForm({
    name: "",
    slug: "",
    role: "",
    manager_id: "none",
    template_slug: "",
    ai_config: {
      provider: "anthropic",
      model_id: "claude-sonnet-4-20250514",
      temperature: 0.7,
      max_tokens: 8192,
      thinking_level: "none",
    },
    capabilities: {} as Record<string, { enabled?: boolean }>,
    channels: { email: true, telegram: false } as Record<string, boolean>,
    permissions: { send_email: "draft" } as Record<string, string>,
    // AI-generated identity (only filled when AgentDrafter generates fresh
    // — no template fit). Posted alongside the form so the controller
    // uses them directly instead of template-rendering blank fields.
    identity_md: "",
    personality_md: "",
    instructions_md: "",
  })

  // Inertia ships the form as flat params; reshape `channels` into the
  // channel_configs[] array our controller's apply_initial_channels! expects.
  transform((d) => {
    const channel_configs: ChannelChoice[] = []
    if (d.channels.email)    channel_configs.push({ channel_type: "email",    config: {} })
    if (d.channels.telegram) channel_configs.push({ channel_type: "telegram", config: {} })
    return {
      name: d.name,
      slug: d.slug,
      role: d.role,
      manager_id: d.manager_id,
      template_slug: d.template_slug,
      ai_config: d.ai_config,
      capabilities: d.capabilities,
      permissions: d.permissions,
      channel_configs,
      identity_md: d.identity_md || undefined,
      personality_md: d.personality_md || undefined,
      instructions_md: d.instructions_md || undefined,
    }
  })

  function rerollName() {
    const next = randomAgentName(introName)
    setIntroName(next)
  }

  // Synthesizes a minimal Template-shaped object so the details step can
  // render even when the templates table is empty (e.g. fresh install with
  // no seeds). The controller already handles a missing template_slug — it
  // just skips the markdown pre-fill.
  function blankTemplate(role: string | null): Template {
    return {
      slug: "",
      name: "Custom agent",
      role: role || "Custom",
      description: "Built from your description — no template applied. You can fine-tune identity, personality, and instructions on the agent's Identity tab after creation.",
      icon: "User",
      capabilities: {},
      suggested_skill_slugs: [],
      suggested_integrations: [],
      suggested_manager_role: null,
      suggested_provider: null,
      suggested_model: null,
      variables: [],
    }
  }

  function applyDraft(name: string, draft: DraftResponse) {
    const tpl = draft.template_slug
      ? templates.find((t) => t.slug === draft.template_slug)
      : null
    // Prefer the LLM's pick → otherwise the first available template →
    // otherwise a blank custom shell so the user is never blocked.
    const fallback = tpl || (draft.generated ? blankTemplate(draft.role) : templates[0] || blankTemplate(draft.role))
    setPicked(fallback)

    const mgr = fallback.suggested_manager_role
      ? agents.find((a) => a.role.toLowerCase() === fallback.suggested_manager_role!.toLowerCase())
      : null

    const merged = { ...fallback.capabilities, ...(draft.capabilities || {}) }

    setData({
      ...data,
      name,
      slug: slugify(name),
      role: draft.role || fallback.role,
      template_slug: fallback.slug,
      manager_id: mgr?.id || "none",
      capabilities: merged,
      ai_config: {
        ...data.ai_config,
        provider: draft.provider || fallback.suggested_provider || data.ai_config.provider,
        model_id: draft.model_id || fallback.suggested_model || data.ai_config.model_id,
      },
      channels: { email: wantEmail, telegram: wantTelegram },
      // When AgentDrafter generated fresh copy (no template fit), pipe it
      // straight into the form so the controller saves it instead of
      // doing a template render that would leave the fields blank.
      identity_md: draft.identity_md || "",
      personality_md: draft.personality_md || "",
      instructions_md: draft.instructions_md || "",
    })
    setDraftReasoning(draft.reasoning)
    setIsGenerated(draft.generated === true)
    setStep("details")
    return true
  }

  // Stage timer for the 3-step spinner shown during drafting. Total ~3s
  // visual feedback that the backend is doing real work. Each stage maps
  // to a phase the user can recognize: analyze → resolve skills → draft.
  async function withStagedSpinner<T>(fn: () => Promise<T>): Promise<T> {
    setDraftStage(1)
    const t1 = setTimeout(() => setDraftStage(2), 800)
    const t2 = setTimeout(() => setDraftStage(3), 1800)
    try {
      const result = await fn()
      return result
    } finally {
      clearTimeout(t1); clearTimeout(t2)
      setDraftStage(0)
    }
  }

  async function fetchDraft(opts: { regenerate?: boolean } = {}): Promise<DraftResponse | null> {
    const csrfToken = document
      .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
      ?.getAttribute("content")
    const res = await fetch("/agents/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: JSON.stringify({
        description,
        tools_preference: toolsPreference,
        tools_description: toolsPreference === "specify" ? toolsDescription : "",
        regenerate: opts.regenerate || false,
      }),
    })
    const body = (await res.json()) as DraftResponse | { error?: string }
    if (!res.ok) {
      setDraftError((body as { error?: string }).error || "Couldn't draft an agent. Try again.")
      return null
    }
    return body as DraftResponse
  }

  async function handleIntroSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDraftError(null)
    if (!description.trim()) {
      setDraftError("Tell us what you want this agent to do.")
      return
    }

    setDrafting(true)
    try {
      const draft = await withStagedSpinner(() => fetchDraft())
      if (!draft) return
      const name = introName.trim() || draft.name_suggestion || randomAgentName()
      applyDraft(name, draft)
    } catch (err) {
      setDraftError("Network error. Try again.")
    } finally {
      setDrafting(false)
    }
  }

  async function handleRegenerate() {
    setDraftError(null)
    setDrafting(true)
    try {
      const draft = await withStagedSpinner(() => fetchDraft({ regenerate: true }))
      if (!draft) return
      // Keep the existing form name but refresh markdown fields + reasoning.
      setData({
        ...data,
        identity_md: draft.identity_md || "",
        personality_md: draft.personality_md || "",
        instructions_md: draft.instructions_md || "",
      })
      setDraftReasoning(draft.reasoning)
      setIsGenerated(draft.generated === true)
    } catch (err) {
      setDraftError("Network error during regenerate.")
    } finally {
      setDrafting(false)
    }
  }

  // Mount-time pre-fill when arriving via /agents/new?template=<slug>.
  // We call chooseTemplate after the form is initialized so it can write
  // into setData. Empty dep array — runs once.
  useEffect(() => {
    if (typeof window === "undefined") return
    const slug = new URLSearchParams(window.location.search).get("template")
    if (!slug) return
    const t = templates.find((x) => x.slug === slug)
    if (t) chooseTemplate(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function chooseTemplate(t: Template) {
    setPicked(t)
    const mgr = t.suggested_manager_role
      ? agents.find((a) => a.role.toLowerCase() === t.suggested_manager_role!.toLowerCase())
      : null
    const name = introName.trim() || randomAgentName()
    setData({
      ...data,
      name,
      slug: slugify(name),
      role: t.role,
      template_slug: t.slug,
      manager_id: mgr?.id || "none",
      capabilities: t.capabilities,
      ai_config: {
        ...data.ai_config,
        provider: t.suggested_provider || data.ai_config.provider,
        model_id: t.suggested_model  || data.ai_config.model_id,
      },
      channels: { email: wantEmail, telegram: wantTelegram },
    })
    setStep("details")
  }

  function handleNameChange(name: string) {
    setData({
      ...data,
      name,
      slug: slugify(name),
    })
  }

  function rerollDetailsName() {
    const next = randomAgentName(data.name)
    setData({ ...data, name: next, slug: slugify(next) })
  }

  function toggleCap(key: string, enabled: boolean) {
    setData("capabilities", {
      ...data.capabilities,
      [key]: { ...(data.capabilities[key] || {}), enabled },
    })
  }

  function toggleChannel(key: "email" | "telegram", enabled: boolean) {
    setData("channels", { ...data.channels, [key]: enabled })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    post(agentsPath())
  }

  // ── Step 1: intro wizard ───────────────────────────────────────────────
  if (step === "intro") {
    return (
      <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
        <Head title="New agent" />
        <div className="flex items-start justify-between gap-4 mb-2">
          <PageHeader
            eyebrow="New agent"
            title="What should this agent do?"
            description="Describe the role in plain English. We'll match it to a template, suggest skills, and pre-fill identity + model — fine-tune anything in the next step."
          />
          {templates.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5 shrink-0"
              onClick={() => setShowTemplatePanel((v) => !v)}
            >
              <icons.LayoutGrid className="size-3.5" />
              {showTemplatePanel ? "Hide templates" : "Browse templates"}
            </Button>
          )}
        </div>

      <div className={`flex gap-6 ${showTemplatePanel ? "items-start" : ""}`}>
        <form onSubmit={handleIntroSubmit} className={`space-y-6 ${showTemplatePanel ? "flex-1 min-w-0 max-w-2xl" : "max-w-2xl"}`}>
          <section>
            <Overline className="mb-3">Job description</Overline>
            <div className="rounded-lg border bg-card p-5 space-y-2">
              <Label htmlFor="description" className="sr-only">Job description</Label>
              <textarea
                id="description"
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. An SDR that books demos for our B2B SaaS — sources leads from LinkedIn, drafts personalized cold emails, and hands warm replies to AEs."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <p className="text-[10px] text-muted-foreground">A sentence or two is enough — be specific about what success looks like.</p>
            </div>
          </section>

          <section>
            <Overline className="mb-3">Tools</Overline>
            <div className="rounded-lg border bg-card p-5 space-y-4">
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="tools_preference"
                    value="recommend"
                    checked={toolsPreference === "recommend"}
                    onChange={() => setToolsPreference("recommend")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-medium">Recommend tools for me</div>
                    <div className="text-xs text-muted-foreground">We'll pick the right skills based on the role (e.g. Apollo for SDRs, Ahrefs for SEO).</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="tools_preference"
                    value="specify"
                    checked={toolsPreference === "specify"}
                    onChange={() => setToolsPreference("specify")}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">I'll specify the tools</div>
                    <div className="text-xs text-muted-foreground">List the tools you want — we'll wire up matching skills.</div>
                  </div>
                </label>
              </div>
              {toolsPreference === "specify" && (
                <div className="space-y-2 pt-2 border-t">
                  <Label htmlFor="tools_description">Tools to use</Label>
                  <textarea
                    id="tools_description"
                    rows={3}
                    value={toolsDescription}
                    onChange={(e) => setToolsDescription(e.target.value)}
                    placeholder="e.g. Apollo for lead generation, Gmail for outreach, HubSpot to log activity"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          </section>

          <section>
            <Overline className="mb-3">Channels</Overline>
            <p className="text-xs text-muted-foreground mb-3 max-w-lg">
              How should people reach this agent? You can connect more later.
            </p>
            <div className="rounded-lg border bg-card divide-y">
              <label className={`flex items-start justify-between gap-4 p-4 ${org_email_domain ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Email address</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {org_email_domain ? (
                      <>We'll provision <span className="font-mono">{slugify(introName) || "name"}@{org_email_domain}</span>. Replies route to the agent automatically.</>
                    ) : (
                      <>Pick a workspace email domain in <a href="/settings" className="underline">Settings</a> first.</>
                    )}
                  </div>
                </div>
                <Checkbox checked={wantEmail && !!org_email_domain} disabled={!org_email_domain} onCheckedChange={(v) => setWantEmail(!!v)} className="mt-1" />
              </label>
              <label className="flex items-start justify-between gap-4 p-4 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Telegram bot</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Reserve a Telegram channel for this agent. You'll paste a bot token from @BotFather after creation.
                  </div>
                </div>
                <Checkbox checked={wantTelegram} onCheckedChange={(v) => setWantTelegram(!!v)} className="mt-1" />
              </label>
            </div>
          </section>

          <section>
            <Overline className="mb-3">Name</Overline>
            <div className="rounded-lg border bg-card p-5 space-y-2">
              <Label htmlFor="intro_name">Agent name</Label>
              <div className="flex gap-2">
                <Input
                  id="intro_name"
                  value={introName}
                  onChange={(e) => setIntroName(e.target.value)}
                  placeholder="e.g. Sarah, Atlas, Mira"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={rerollName}
                  title="Roll a new random name"
                  aria-label="Roll a new random name"
                >
                  <icons.Dices className="size-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                We pre-fill a random name. Click the dice to re-roll, or type your own.
              </p>
            </div>
          </section>

          {draftError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {draftError}
            </div>
          )}

          <div className="flex justify-between items-center pb-8">
            {templates.length > 0 && !showTemplatePanel ? (
              <button
                type="button"
                onClick={() => setShowTemplatePanel(true)}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Or start from a template →
              </button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={drafting || !description.trim()}>
              {drafting ? draftStageLabel(draftStage) : "Draft my agent"}
            </Button>
          </div>
        </form>

        {showTemplatePanel && (
          <aside className="w-[20rem] lg:w-[22rem] shrink-0 sticky top-4 self-start">
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <icons.LayoutGrid className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Template library</span>
                  <span className="text-[10px] text-muted-foreground">({templates.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTemplatePanel(false)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Close template panel"
                >
                  <icons.X className="size-3.5" />
                </button>
              </div>
              <div className="px-3 py-2 border-b">
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Search templates…"
                  className="h-8 text-xs"
                />
              </div>
              <div className="max-h-[calc(100vh-14rem)] overflow-y-auto p-2 space-y-1.5">
                {filteredTemplates.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-6">No templates match "{templateSearch}".</p>
                )}
                {filteredTemplates.map((t) => {
                  const Icon = (icons as any)[t.icon] || icons.User
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => chooseTemplate(t)}
                      className="w-full group rounded-md border bg-background p-2.5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="size-6 rounded-sm bg-muted flex items-center justify-center shrink-0">
                          <Icon className="size-3" />
                        </div>
                        <div className="font-medium text-xs truncate">{t.name}</div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-1.5 line-clamp-2 leading-snug">{t.description}</p>
                      {t.suggested_skill_slugs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {t.suggested_skill_slugs.slice(0, 3).map((s) => (
                            <span key={s} className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[7rem]">{s}</span>
                          ))}
                          {t.suggested_skill_slugs.length > 3 && (
                            <span className="text-[9px] text-muted-foreground">+{t.suggested_skill_slugs.length - 3}</span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </aside>
        )}
      </div>
      </AppLayout>
    )
  }

  // ── Step 2: details (pre-filled from intro draft or template panel) ───
  if (!picked) {
    // Defensive: if we somehow landed here without a picked template, send
    // the user back to the intro.
    setStep("intro")
    return null
  }
  const PickedIcon = (icons as any)[picked.icon] || icons.User

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
      <Head title={`New ${picked.name}`} />
      <PageHeader
        eyebrow={`${picked.name} template`}
        title={`Configure your ${data.role || picked.role}`}
        description={picked.description}
      />

      {draftReasoning && !isGenerated && (
        <div className="max-w-2xl mb-6 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Why this template:</span> {draftReasoning}
        </div>
      )}

      {isGenerated && (
        <div className="max-w-2xl mb-6 rounded-lg border border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-950/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <icons.Sparkles className="size-4 text-purple-600" />
              <span className="text-sm font-semibold">AI-generated identity</span>
              <span className="rounded bg-purple-200 dark:bg-purple-800 px-1.5 py-0.5 text-[10px] uppercase">fresh</span>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleRegenerate} disabled={drafting}>
              <icons.RefreshCw className={`size-3.5 ${drafting ? "animate-spin" : ""}`} />
              <span className="ml-1.5 text-xs">{drafting ? draftStageLabel(draftStage) : "Regenerate"}</span>
            </Button>
          </div>
          {draftReasoning && (
            <p className="text-xs text-muted-foreground">{draftReasoning}</p>
          )}
          <GeneratedField
            label="Identity"
            value={data.identity_md}
            onChange={(v) => setData("identity_md", v)}
            editing={editingField === "identity"}
            onToggleEdit={() => setEditingField(editingField === "identity" ? null : "identity")}
          />
          <GeneratedField
            label="Personality"
            value={data.personality_md}
            onChange={(v) => setData("personality_md", v)}
            editing={editingField === "personality"}
            onToggleEdit={() => setEditingField(editingField === "personality" ? null : "personality")}
          />
          <GeneratedField
            label="Instructions"
            value={data.instructions_md}
            onChange={(v) => setData("instructions_md", v)}
            editing={editingField === "instructions"}
            onToggleEdit={() => setEditingField(editingField === "instructions" ? null : "instructions")}
          />
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <section>
          <Overline className="mb-3">Identity</Overline>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b">
              <div className="size-10 rounded-md bg-muted flex items-center justify-center">
                <PickedIcon className="size-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{picked.name} template</div>
                <div className="text-xs text-muted-foreground">Identity, personality, and instructions will be filled in from the template. You can edit them on the agent's Identity tab after creation.</div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setStep("intro")}>
                Start over
              </Button>
            </div>

            {(picked.suggested_skill_slugs.length > 0 || (picked.suggested_integrations?.length ?? 0) > 0) && (
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
                <div className="font-medium text-foreground mb-1">This template bundles:</div>
                {picked.suggested_skill_slugs.length > 0 && (
                  <div className="text-muted-foreground">
                    <span className="font-medium">Skills:</span> {picked.suggested_skill_slugs.join(", ")}
                  </div>
                )}
                {(picked.suggested_integrations?.length ?? 0) > 0 && (
                  <div className="text-muted-foreground">
                    <span className="font-medium">Integrations to connect:</span> {(picked.suggested_integrations || []).map((s) => s.replace(/_/g, " ")).join(", ")}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="flex gap-2">
                  <Input id="name" placeholder="e.g. Alex, Sarah, Marcus" value={data.name} onChange={(e) => handleNameChange(e.target.value)} required />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={rerollDetailsName}
                    title="Roll a new random name"
                    aria-label="Roll a new random name"
                  >
                    <icons.Dices className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={data.slug} onChange={(e) => setData("slug", e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" value={data.role} onChange={(e) => setData("role", e.target.value)} required />
              <p className="text-[10px] text-muted-foreground">Free-text. Used by other agents to target this one via <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">assign_to_role</code>.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manager">Reports to</Label>
              <Select value={data.manager_id} onValueChange={(v) => setData("manager_id", v)}>
                <SelectTrigger id="manager">
                  <SelectValue placeholder="No manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manager (top level)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} <span className="text-muted-foreground">— {a.role}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {picked.suggested_manager_role && (
                <p className="text-[10px] text-muted-foreground">Template suggests a manager with role: <strong>{picked.suggested_manager_role}</strong></p>
              )}
            </div>
          </div>
        </section>

        <section>
          <Overline className="mb-3">Model</Overline>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={data.ai_config.provider}
                  onValueChange={(v) => {
                    const defaultModel = MODELS_BY_PROVIDER[v]?.[0]?.value || ""
                    setData("ai_config", { ...data.ai_config, provider: v, model_id: defaultModel })
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Model</Label>
                <Select
                  value={data.ai_config.model_id}
                  onValueChange={(v) => setData("ai_config", { ...data.ai_config, model_id: v })}
                >
                  <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Pick a model" /></SelectTrigger>
                  <SelectContent>
                    {(MODELS_BY_PROVIDER[data.ai_config.provider] || []).map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <span className="font-medium">{m.label}</span>
                        {m.hint && <span className="text-muted-foreground"> — {m.hint}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {picked.suggested_model
                ? <>Template recommends <span className="font-mono">{picked.suggested_model}</span> for this role. Override if you want.</>
                : "Sonnet is the daily driver. Opus for heavy reasoning / long tasks. Haiku for cheap + fast background work."}
            </p>
          </div>
        </section>

        <section>
          <Overline className="mb-3">Capabilities</Overline>
          <p className="text-xs text-muted-foreground mb-3 max-w-lg">
            Toggles for what this agent can do. The template pre-selects what makes sense for the role — adjust as needed.
          </p>
          <div className="rounded-lg border bg-card divide-y">
            {CAPABILITIES.map((cap) => {
              const enabled = data.capabilities[cap.key]?.enabled === true
              return (
                <div key={cap.key} className="flex items-start justify-between gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{cap.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{cap.description}</div>
                  </div>
                  <Checkbox checked={enabled} onCheckedChange={(v) => toggleCap(cap.key, !!v)} className="mt-1" />
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <Overline className="mb-3">Channels</Overline>
          <p className="text-xs text-muted-foreground mb-3 max-w-lg">
            We'll provision these when the agent is created. You can add more (SMS, WhatsApp, Slack) on the Channels tab.
          </p>
          <div className="rounded-lg border bg-card divide-y">
            <div className={`flex items-start justify-between gap-4 p-4 ${org_email_domain ? "" : "opacity-60"}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Email</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {org_email_domain ? (
                    <span className="font-mono">{data.slug || "agent"}@{org_email_domain}</span>
                  ) : (
                    <>Set a workspace email domain in <a href="/settings" className="underline">Settings</a> to enable.</>
                  )}
                </div>
              </div>
              <Checkbox checked={data.channels.email && !!org_email_domain} disabled={!org_email_domain} onCheckedChange={(v) => toggleChannel("email", !!v)} className="mt-1" />
            </div>
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Telegram bot</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Reserved as pending — paste a bot token in Channels to finish the connection.
                </div>
              </div>
              <Checkbox checked={data.channels.telegram} onCheckedChange={(v) => toggleChannel("telegram", !!v)} className="mt-1" />
            </div>
          </div>
        </section>

        <section>
          <Overline className="mb-3">Permissions</Overline>
          <p className="text-xs text-muted-foreground mb-3 max-w-lg">
            Control whether the agent acts autonomously or asks first. You can change this anytime on the agent edit page.
          </p>
          <div className="rounded-lg border bg-card p-4 space-y-4 max-w-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-sm font-medium">Send email</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Default for new agents. Draft mode is safest while you're getting a feel for how the agent behaves.
                </div>
              </div>
              <Select
                value={data.permissions?.send_email || "draft"}
                onValueChange={(v) => setData("permissions", { ...data.permissions, send_email: v })}
              >
                <SelectTrigger className="w-48 h-8 text-xs shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (send immediately)</SelectItem>
                  <SelectItem value="draft">Draft (require approval)</SelectItem>
                  <SelectItem value="never">Never (disabled)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2 pb-8 max-w-2xl">
          <Button type="button" variant="ghost" onClick={() => setStep("intro")}>Back</Button>
          <Button type="submit" disabled={processing || !data.name}>
            {processing ? "Creating…" : "Create agent"}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}

// Maps the 0-3 draft stage value to a user-visible label. 0 means we're
// not drafting; 1-3 walk through the conceptual server-side phases.
function draftStageLabel(stage: number): string {
  switch (stage) {
    case 1: return "Analyzing capabilities…"
    case 2: return "Resolving skills…"
    case 3: return "Drafting identity…"
    default: return "Drafting…"
  }
}

// One field block on the AI-generated identity card. Preview-by-default
// (truncated to 14 lines), expand to see full, Edit toggles a textarea
// so the user can tweak before saving the agent. Edits flow straight
// into the form `data` via the onChange callback.
function GeneratedField({
  label, value, onChange, editing, onToggleEdit,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  editing: boolean
  onToggleEdit: () => void
}) {
  return (
    <div className="rounded border bg-background p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium uppercase text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onToggleEdit}
          className="text-[11px] text-purple-700 dark:text-purple-300 hover:underline"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(20, Math.max(6, value.split("\n").length + 1))}
          className="w-full rounded border bg-background px-2 py-1.5 text-xs font-mono"
        />
      ) : (
        <pre className="whitespace-pre-wrap text-xs">{value || <span className="text-muted-foreground italic">(empty)</span>}</pre>
      )}
    </div>
  )
}
