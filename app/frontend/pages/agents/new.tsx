import { Head, useForm } from "@inertiajs/react"
import { useState } from "react"
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
  org_email_domain: string
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

type Step = "intro" | "template" | "details"

export default function AgentNew({ templates, agents, org_email_domain }: Props) {
  const [step, setStep] = useState<Step>("intro")
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

  const { data, setData, post, processing, transform } = useForm({
    name: "",
    slug: "",
    role: "",
    manager_id: "none" as string,
    template_slug: "",
    ai_config: {
      provider: "anthropic",
      model_id: "claude-sonnet-4-20250514",
      temperature: 0.7,
      max_tokens: 8192,
      thinking_level: "none",
    },
    capabilities: {} as Record<string, { enabled?: boolean; [k: string]: unknown }>,
    channels: { email: true, telegram: false } as Record<string, boolean>,
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
      channel_configs,
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
    const fallback = tpl || templates[0] || blankTemplate(draft.role)
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
    })
    setDraftReasoning(draft.reasoning)
    setStep("details")
    return true
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
        }),
      })
      const body = (await res.json()) as DraftResponse | { error?: string }
      if (!res.ok) {
        setDraftError((body as { error?: string }).error || "Couldn't draft an agent. Try again.")
        return
      }
      const draft = body as DraftResponse
      const name = introName.trim() || draft.name_suggestion || randomAgentName()
      applyDraft(name, draft)
    } catch (err) {
      setDraftError("Network error. Try again.")
    } finally {
      setDrafting(false)
    }
  }

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
        <PageHeader
          eyebrow="Hire"
          title="Describe your new agent"
          description="Tell us what you want this teammate to do. We'll match it to the right template, skills, and model — you can fine-tune everything in the next step."
        />

        <form onSubmit={handleIntroSubmit} className="max-w-2xl space-y-6">
          <section>
            <Overline className="mb-3">What should this agent do?</Overline>
            <div className="rounded-lg border bg-card p-5 space-y-2">
              <Label htmlFor="description">Job description</Label>
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
              <label className="flex items-start justify-between gap-4 p-4 cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Email address</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    We'll provision <span className="font-mono">{slugify(introName) || "name"}@{org_email_domain}</span>. Replies route to the agent automatically.
                  </div>
                </div>
                <Checkbox checked={wantEmail} onCheckedChange={(v) => setWantEmail(!!v)} className="mt-1" />
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

          <div className="flex justify-between items-center pb-8 max-w-2xl">
            {templates.length > 0 ? (
              <button
                type="button"
                onClick={() => setStep("template")}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Browse templates instead →
              </button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={drafting || !description.trim()}>
              {drafting ? "Drafting…" : "Draft my agent"}
            </Button>
          </div>
        </form>
      </AppLayout>
    )
  }

  // ── Step 2a: template grid (legacy/manual path) ────────────────────────
  if (step === "template") {
    return (
      <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
        <Head title="New agent" />
        <PageHeader
          eyebrow="Hire"
          title="Pick a role"
          description="Each template ships with ready-made identity, personality, instructions, and a suggested skill pack. You can edit them once the agent is created."
        />
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setStep("intro")}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            ← Back to describe your agent
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
          {templates.map((t) => {
            const Icon = (icons as any)[t.icon] || icons.User
            return (
              <button
                key={t.slug}
                type="button"
                onClick={() => chooseTemplate(t)}
                className="group rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="size-8 rounded-md bg-muted flex items-center justify-center">
                    <Icon className="size-4" />
                  </div>
                  <div className="font-medium text-sm">{t.name}</div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{t.description}</p>
                <div className="flex flex-wrap gap-1">
                  {t.suggested_manager_role && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      reports to {t.suggested_manager_role}
                    </span>
                  )}
                  {t.suggested_skill_slugs.slice(0, 3).map((s) => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s}</span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </AppLayout>
    )
  }

  // ── Step 3: details (pre-filled from intro draft or template grid) ────
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
        eyebrow={picked.name}
        title={`Hire your ${data.role || picked.role}`}
        description={picked.description}
      />

      {draftReasoning && (
        <div className="max-w-2xl mb-6 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Why this template:</span> {draftReasoning}
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
              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={data.ai_config.model_id}
                  onValueChange={(v) => setData("ai_config", { ...data.ai_config, model_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Pick a model" /></SelectTrigger>
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
            <div className="flex items-start justify-between gap-4 p-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Email</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-mono">{data.slug || "agent"}@{org_email_domain}</span>
                </div>
              </div>
              <Checkbox checked={data.channels.email} onCheckedChange={(v) => toggleChannel("email", !!v)} className="mt-1" />
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

        <div className="flex justify-end gap-2 pb-8 max-w-2xl">
          <Button type="button" variant="ghost" onClick={() => setStep("intro")}>Back</Button>
          <Button type="submit" disabled={processing || !data.name}>
            {processing ? "Creating…" : `Hire ${data.name || picked.name}`}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}
