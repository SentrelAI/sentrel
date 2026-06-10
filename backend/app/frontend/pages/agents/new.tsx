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

// Deterministic agent creation. No AI anywhere in this flow: pick a
// template (or Blank), every field pre-fills from the template row,
// edit whatever you want, hit Create. Persona markdown comes from the
// template server-side at install time (AgentTemplates::Installer) —
// for Blank agents you write it on the Identity tab after creation.

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

// Default capability set for a Blank agent — everything broadly useful
// on, media off. Templates override with their own stored map.
const DEFAULT_CAPS: Record<string, { enabled: boolean }> = {
  knowledge_base: { enabled: true },
  scheduling:     { enabled: true },
  tasks:          { enabled: true },
  integrations:   { enabled: true },
  recall:         { enabled: true },
  send_media:     { enabled: false },
}

// The "start from scratch" card. slug: "" means the controller takes the
// direct-create path (no template render) and the persona stays empty
// until the user writes it on the Identity tab.
const BLANK: Template = {
  slug: "",
  name: "Blank",
  role: "",
  description: "Start from scratch. You write the identity, personality, and instructions on the agent's Identity tab after creation.",
  icon: "SquarePen",
  capabilities: DEFAULT_CAPS,
  suggested_skill_slugs: [],
  suggested_integrations: [],
  suggested_manager_role: null,
  suggested_provider: null,
  suggested_model: null,
  variables: [],
}

export default function AgentNew({ templates, agents, org_email_domain }: Props) {
  const [picked, setPicked] = useState<Template>(BLANK)

  const { data, setData, post, processing, transform } = useForm({
    name: randomAgentName(),
    slug: "",
    role: "",
    manager_id: "none",
    template_slug: "",
    ai_config: {
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
      temperature: 0.7,
      max_tokens: 8192,
      thinking_level: "none",
    },
    capabilities: DEFAULT_CAPS as Record<string, { enabled?: boolean }>,
    channels: { email: !!org_email_domain, telegram: false } as Record<string, boolean>,
    // New agents start in DRAFT mode for send_email — flip to Auto once
    // you trust the agent's outbound.
    permissions: { send_email: "draft" } as Record<string, string>,
    skill_slugs_override: [] as string[],
  })

  // Slug derives from name on first render (useForm initializers can't
  // reference each other).
  useEffect(() => {
    if (!data.slug && data.name) setData("slug", slugify(data.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reshape `channels` into the channel_configs[] array the controller's
  // apply_initial_channels! expects.
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
      skill_slugs_override: d.skill_slugs_override,
    }
  })

  // Deep-link: /agents/new?template=<slug> (the Install button on a
  // template page) pre-picks that template.
  useEffect(() => {
    if (typeof window === "undefined") return
    const slug = new URLSearchParams(window.location.search).get("template")
    if (!slug) return
    const t = templates.find((x) => x.slug === slug)
    if (t) choose(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function choose(t: Template) {
    setPicked(t)
    const mgr = t.suggested_manager_role
      ? agents.find((a) => a.role.toLowerCase() === t.suggested_manager_role!.toLowerCase())
      : null
    setData({
      ...data,
      role: t.role,
      template_slug: t.slug,
      manager_id: mgr?.id || "none",
      capabilities: t.slug ? t.capabilities : DEFAULT_CAPS,
      ai_config: {
        ...data.ai_config,
        provider: t.suggested_provider || "anthropic",
        model_id: t.suggested_model || "claude-sonnet-4-6",
      },
      skill_slugs_override: t.suggested_skill_slugs,
    })
  }

  function handleNameChange(name: string) {
    setData({ ...data, name, slug: slugify(name) })
  }

  function rerollName() {
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

  const allCards = [BLANK, ...templates]

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
      <Head title="New agent" />
      <PageHeader
        eyebrow="New agent"
        title="Create an agent"
        description="Pick a starting point, adjust anything below, hit Create. Identity and instructions are editable on the agent's Identity tab after creation."
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {/* ── Starting point ─────────────────────────────────────────── */}
        <section>
          <Overline className="mb-3">Starting point</Overline>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allCards.map((t) => {
              const Icon = (icons as any)[t.icon] || icons.User
              const active = picked.slug === t.slug && picked.name === t.name
              return (
                <button
                  key={t.slug || "__blank__"}
                  type="button"
                  onClick={() => choose(t)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-foreground bg-muted/40"
                      : "bg-card hover:border-foreground/30 hover:bg-muted/20"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="size-6 rounded-sm bg-muted flex items-center justify-center shrink-0">
                      <Icon className="size-3.5" />
                    </div>
                    <span className="font-medium text-xs truncate">{t.name}</span>
                    {active && <icons.Check className="size-3.5 ml-auto shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                    {t.slug ? t.role : "Start from scratch"}
                  </p>
                </button>
              )
            })}
          </div>

          {(picked.suggested_skill_slugs.length > 0 || (picked.suggested_integrations?.length ?? 0) > 0) && (
            <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
              {picked.suggested_skill_slugs.length > 0 && (
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">Skills:</span> {picked.suggested_skill_slugs.join(", ")}
                </div>
              )}
              {(picked.suggested_integrations?.length ?? 0) > 0 && (
                <div className="text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">Integrations to connect:</span> {(picked.suggested_integrations || []).map((s) => s.replace(/_/g, " ")).join(", ")}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Identity ───────────────────────────────────────────────── */}
        <section>
          <Overline className="mb-3">Identity</Overline>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="flex gap-2">
                  <Input id="name" placeholder="e.g. Alex, Sarah, Marcus" value={data.name} onChange={(e) => handleNameChange(e.target.value)} required />
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={data.slug} onChange={(e) => setData("slug", e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" placeholder="e.g. Sales Development Rep" value={data.role} onChange={(e) => setData("role", e.target.value)} required />
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

        {/* ── Model ──────────────────────────────────────────────────── */}
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

        {/* ── Capabilities ───────────────────────────────────────────── */}
        <section>
          <Overline className="mb-3">Capabilities</Overline>
          <p className="text-xs text-muted-foreground mb-3 max-w-lg">
            Toggles for what this agent can do — adjust as needed.
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

        {/* ── Channels ───────────────────────────────────────────────── */}
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

        {/* ── Permissions ────────────────────────────────────────────── */}
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
                  Draft mode is safest while you're getting a feel for how the agent behaves.
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

        <div className="flex justify-end pb-8 max-w-2xl">
          <Button type="submit" disabled={processing || !data.name || !data.role}>
            {processing ? "Creating…" : "Create agent"}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}
