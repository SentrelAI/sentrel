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
}

const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-opus-4-7",            label: "Claude Opus 4.7",   hint: "strongest reasoning, slowest + priciest" },
    { value: "claude-opus-4-6",            label: "Claude Opus 4.6",   hint: "previous Opus, still excellent" },
    { value: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", hint: "recommended default — fast + smart" },
    { value: "claude-sonnet-4-20250514",   label: "Claude Sonnet 4",   hint: "stable earlier Sonnet" },
    { value: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  hint: "fastest + cheapest, good for background tasks" },
  ],
  openai: [
    { value: "gpt-4o",       label: "GPT-4o",       hint: "multimodal flagship" },
    { value: "gpt-4o-mini",  label: "GPT-4o Mini",  hint: "cheap + fast" },
    { value: "o1",           label: "o1",           hint: "reasoning model, slow + expensive" },
    { value: "o3-mini",      label: "o3-mini",      hint: "reasoning, cheaper than o1" },
  ],
  google: [
    { value: "gemini-2.5-pro",   label: "Gemini 2.5 Pro",   hint: "long context, good at structured data" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "fast + cheap" },
  ],
  openrouter: [
    { value: "anthropic/claude-opus-4-7",   label: "Claude Opus 4.7 (via OpenRouter)" },
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6 (via OpenRouter)" },
    { value: "openai/gpt-4o",               label: "GPT-4o (via OpenRouter)" },
    { value: "meta-llama/llama-3.1-405b",   label: "Llama 3.1 405B (via OpenRouter)" },
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

export default function AgentNew({ templates, agents }: Props) {
  const [picked, setPicked] = useState<Template | null>(null)

  const { data, setData, post, processing } = useForm({
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
  })

  function choose(t: Template) {
    setPicked(t)
    // Prefill defaults from the template. Manager defaults to the first agent
    // whose role matches suggested_manager_role (if any). Model + provider
    // use the template's recommendation (Opus for CEO/Engineer, Sonnet for
    // most, Haiku for Support/SDR).
    const mgr = t.suggested_manager_role
      ? agents.find((a) => a.role.toLowerCase() === t.suggested_manager_role!.toLowerCase())
      : null
    setData({
      ...data,
      role: t.role,
      template_slug: t.slug,
      manager_id: mgr?.id || "none",
      capabilities: t.capabilities,
      ai_config: {
        ...data.ai_config,
        provider: t.suggested_provider || data.ai_config.provider,
        model_id: t.suggested_model  || data.ai_config.model_id,
      },
    })
  }

  function handleNameChange(name: string) {
    setData({
      ...data,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    })
  }

  function toggleCap(key: string, enabled: boolean) {
    setData("capabilities", {
      ...data.capabilities,
      [key]: { ...(data.capabilities[key] || {}), enabled },
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    post(agentsPath())
  }

  // Step 1 — template picker
  if (!picked) {
    return (
      <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
        <Head title="New agent" />
        <PageHeader
          eyebrow="Hire"
          title="Pick a role"
          description="Each template ships with ready-made identity, personality, instructions, and a suggested skill pack. You can edit them once the agent is created."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl">
          {templates.map((t) => {
            const Icon = (icons as any)[t.icon] || icons.User
            return (
              <button
                key={t.slug}
                type="button"
                onClick={() => choose(t)}
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

  // Step 2 — minimal details form
  const PickedIcon = (icons as any)[picked.icon] || icons.User

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Agents", href: agentsPath() }, { label: "New" }]}>
      <Head title={`New ${picked.name}`} />
      <PageHeader
        eyebrow={picked.name}
        title={`Hire your ${picked.role}`}
        description={picked.description}
      />

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
              <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setPicked(null)}>
                Change template
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" placeholder="e.g. Alex, Sarah, Marcus" value={data.name} onChange={(e) => handleNameChange(e.target.value)} required />
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

        <div className="flex justify-end gap-2 pb-8 max-w-2xl">
          <Button type="button" variant="ghost" onClick={() => setPicked(null)}>Back</Button>
          <Button type="submit" disabled={processing || !data.name}>
            {processing ? "Creating…" : `Hire ${data.name || picked.name}`}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}

