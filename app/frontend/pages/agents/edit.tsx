import { useState } from "react"
import { Head, Link, useForm } from "@inertiajs/react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { agentPath, agentsPath, dashboardPath } from "@/routes"
import { ToolPoliciesSection } from "@/components/tool-policies-section"
import type { Agent } from "@/types"

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

interface AgentSummary {
  id: string
  name: string
  slug: string
  role: string
}

interface Props {
  agent: Agent
  agents: AgentSummary[]
}

export default function AgentEdit({ agent, agents = [] }: Props) {
  const currentManagerId = (agent as any).manager?.id
    ? (typeof (agent as any).manager.id === "string" ? (agent as any).manager.id : String((agent as any).manager.id))
    : "none"

  const { data, setData, patch, processing } = useForm({
    name: agent.name,
    slug: agent.slug,
    role: agent.role,
    manager_id: currentManagerId as string,
    email_signature_md: (agent as any).email_signature_md || "",
    heartbeat_enabled: agent.heartbeat_enabled,
    heartbeat_interval_minutes: agent.heartbeat_interval_minutes,
    ai_config: {
      provider: agent.ai_config?.provider || "anthropic",
      model_id: agent.ai_config?.model_id || "claude-sonnet-4-20250514",
      temperature: agent.ai_config?.temperature || 0.7,
      max_tokens: agent.ai_config?.max_tokens || 8192,
      thinking_level: agent.ai_config?.thinking_level || "none",
    },
    spend_daily_cap_usd: (agent as { spend_daily_cap_usd?: number | null }).spend_daily_cap_usd ?? null,
    spend_monthly_cap_usd: (agent as { spend_monthly_cap_usd?: number | null }).spend_monthly_cap_usd ?? null,
    spend_notify_threshold_pct: (agent as { spend_notify_threshold_pct?: number }).spend_notify_threshold_pct ?? 0.8,
    permissions: (agent as any).permissions || {},
    capabilities: (agent as any).capabilities || {
      knowledge_base: { enabled: false, always_retrieve: true, threshold: 0.75, top_k: 5 },
      scheduling:   { enabled: true },
      tasks:        { enabled: true },
      integrations: { enabled: true },
      recall:       { enabled: true },
      send_media:   { enabled: true },
    },
  })

  function setCap(key: string, patch: Record<string, unknown>) {
    setData("capabilities", {
      ...data.capabilities,
      [key]: { ...(data.capabilities as any)[key], ...patch },
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    patch(agentPath(agent.id))
  }

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: dashboardPath() },
        { label: "Agents", href: agentsPath() },
        { label: agent.name, href: agentPath(agent.id) },
        { label: "Edit" },
      ]}
    >
      <Head title={`Edit ${agent.name}`} />

      <PageHeader
        eyebrow="Configure"
        title={`Edit ${agent.name}`}
        description="Tune the agent's identity, model, permissions, and capabilities."
      />

      <EditTabs onSubmit={handleSubmit} processing={processing} agentId={agent.id} />
    </AppLayout>
  )

  function EditTabs({ onSubmit, processing, agentId }: { onSubmit: (e: React.FormEvent) => void; processing: boolean; agentId: number }) {
    const [tab, setTab] = useState<"identity" | "behavior" | "permissions">("identity")
    const TABS: Array<{ key: "identity" | "behavior" | "permissions"; label: string }> = [
      { key: "identity",    label: "Identity" },
      { key: "behavior",    label: "Behavior" },
      { key: "permissions", label: "Permissions" },
    ]
    return (
      <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
        <div className="flex items-center gap-1 rounded-md border bg-card p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-[var(--indigo-surface)] text-[var(--color-indigo)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "identity" && (<>
        {/* Identity */}
        <section>
          <Overline className="mb-3">Identity</Overline>
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={data.name} onChange={(e) => setData("name", e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={data.slug} onChange={(e) => setData("slug", e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input id="role" value={data.role} onChange={(e) => setData("role", e.target.value)} required />
              <p className="text-[10px] text-muted-foreground">
                Free-text. Used by other agents to target this one via <code className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted">assign_to_role</code>.
              </p>
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
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} <span className="text-muted-foreground">— {a.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[10px] text-muted-foreground pt-1">
              Identity, personality, and instructions live on the <Link href={agentPath(agent.id) + "?tab=identity"} className="underline hover:text-foreground">Identity tab</Link> (SOUL.md / PERSONALITY.md / INSTRUCTIONS.md).
            </p>
          </div>
        </section>

        {/* Email Signature */}
        <section>
          <Overline className="mb-3">Email Signature</Overline>
          <div className="rounded-lg border border-border p-4 space-y-2">
            <Label htmlFor="email_signature_md">Signature appended to outgoing emails</Label>
            <textarea
              id="email_signature_md"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono focus-visible:outline-none focus:border-[var(--color-signal)] focus:ring-2 focus:ring-[var(--color-signal)]/10"
              placeholder={`--\n${agent.name}\n${agent.role} @ Alchemy`}
              value={data.email_signature_md}
              onChange={(e) => setData("email_signature_md", e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">If empty, a default signature with name and email will be used</p>
          </div>
        </section>
        </>)}

        {tab === "behavior" && (<>
        {/* Reasoning */}
        <section>
          <Overline className="mb-3">Reasoning</Overline>
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="thinking_level">Extended thinking</Label>
              <Select
                value={data.ai_config.thinking_level}
                onValueChange={(v) => setData("ai_config", { ...data.ai_config, thinking_level: v })}
              >
                <SelectTrigger id="thinking_level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Off — fastest, no reasoning trace</SelectItem>
                  <SelectItem value="low">Low — 2k token budget</SelectItem>
                  <SelectItem value="medium">Medium — 4k token budget</SelectItem>
                  <SelectItem value="high">High — 8k token budget</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Surfaces the model's reasoning trace as a "Thought for Xs" pill above the answer.
                Only effective on Claude 4 / Sonnet 4.x / Opus 4.x — older models silently ignore.
                Costs extra tokens per turn proportional to the budget. After saving, hit Ops → Reload to push to the engine.
              </p>
            </div>
          </div>
        </section>

        {/* Spend caps */}
        <section>
          <Overline className="mb-3">Spend caps</Overline>
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="spend_daily_cap" className="text-xs">Daily cap (USD)</Label>
                <Input
                  id="spend_daily_cap"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="No cap"
                  value={data.spend_daily_cap_usd ?? ""}
                  onChange={(e) => setData("spend_daily_cap_usd", e.target.value === "" ? null : parseFloat(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spend_monthly_cap" className="text-xs">Monthly cap (USD)</Label>
                <Input
                  id="spend_monthly_cap"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="No cap"
                  value={data.spend_monthly_cap_usd ?? ""}
                  onChange={(e) => setData("spend_monthly_cap_usd", e.target.value === "" ? null : parseFloat(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="spend_notify_threshold" className="text-xs">Notify when daily spend reaches</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="spend_notify_threshold"
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={data.spend_notify_threshold_pct}
                  onChange={(e) => setData("spend_notify_threshold_pct", parseFloat(e.target.value))}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">of daily cap (0–1)</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Engine consults these before each run. Hard-stop on over-cap with a "⚠️ Spend cap hit" message; one-time-per-day heads-up when crossing the notify threshold. Leave empty for no limit. After saving, hit Ops → Reload to push to the engine.
            </p>
          </div>
        </section>

        {/* Heartbeat */}
        <section>
          <Overline className="mb-3">Heartbeat</Overline>
          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="heartbeat_enabled"
                checked={data.heartbeat_enabled}
                onCheckedChange={(checked) => setData("heartbeat_enabled", !!checked)}
              />
              <Label htmlFor="heartbeat_enabled">Enable heartbeat</Label>
            </div>
            {data.heartbeat_enabled && (
              <div className="space-y-2">
                <Label htmlFor="heartbeat_interval">Check every (minutes)</Label>
                <Input
                  id="heartbeat_interval"
                  type="number"
                  min={5}
                  max={1440}
                  value={data.heartbeat_interval_minutes}
                  onChange={(e) => setData("heartbeat_interval_minutes", parseInt(e.target.value))}
                  className="w-32"
                />
              </div>
            )}
          </div>
        </section>

        {/* Capabilities */}
        <section>
          <Overline className="mb-3">Capabilities</Overline>
          <p className="text-xs text-muted-foreground mb-3 max-w-lg">
            Toggles for what this agent can do. Gates which tools load, which sections appear in its system prompt, and how much context it pulls each turn.
          </p>
          <div className="rounded-lg border bg-card divide-y">
            {CAPABILITIES.map((cap) => {
              const current = (data.capabilities as any)[cap.key] || {}
              return (
                <div key={cap.key} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{cap.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{cap.description}</div>
                    </div>
                    <Checkbox
                      checked={!!current.enabled}
                      onCheckedChange={(v) => setCap(cap.key, { enabled: !!v })}
                      className="mt-1"
                    />
                  </div>
                  {cap.key === "knowledge_base" && current.enabled && (
                    <div className="grid grid-cols-2 gap-3 pl-0 pt-3 mt-3 border-t">
                      <div className="space-y-1">
                        <Label className="text-[10px]">Similarity threshold</Label>
                        <Input
                          type="number" min={0} max={1} step={0.05}
                          value={current.threshold ?? 0.75}
                          onChange={(e) => setCap("knowledge_base", { threshold: parseFloat(e.target.value) })}
                        />
                        <p className="text-[9px] text-muted-foreground">Higher = stricter match. 0.75 is balanced; 0.85+ for high-precision docs; 0.6 for catch-all reference material.</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Top-k passages</Label>
                        <Input
                          type="number" min={1} max={20}
                          value={current.top_k ?? 5}
                          onChange={(e) => setCap("knowledge_base", { top_k: parseInt(e.target.value, 10) })}
                        />
                        <p className="text-[9px] text-muted-foreground">Max passages to inject into the prompt per turn.</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
        </>)}

        {tab === "permissions" && (<>
        {/* Permissions */}
        <section>
          <Overline className="mb-3">Permissions</Overline>
          <div className="rounded-lg border border-border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Send Email</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Agent can compose and send emails</p>
              </div>
              <Select
                value={data.permissions?.send_email || "auto"}
                onValueChange={(v) => setData("permissions", { ...data.permissions, send_email: v })}
              >
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (send immediately)</SelectItem>
                  <SelectItem value="draft">Draft (requires approval)</SelectItem>
                  <SelectItem value="never">Never (disabled)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ToolPoliciesSection agentId={agentId} />
        </section>
        </>)}

        <div className="flex justify-end gap-2 pb-8">
          <Button variant="outline" asChild>
            <Link href={agentPath(agentId)}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={processing}>
            {processing ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    )
  }
}
