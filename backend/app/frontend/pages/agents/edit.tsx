import { useState } from "react"
import { Head, Link, router, useForm } from "@inertiajs/react"
import { BookMarked, ShieldCheck, CheckCircle2, XCircle, Building2, Plus, Download, FileJson, Eye, EyeOff } from "lucide-react"

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

interface OrgCredential {
  id: number
  kind: "llm_api_key" | "cloud_provider" | "generic"
  provider: string
  name: string
}

interface AgentApprovalRule {
  id: number
  label: string | null
  scope: "agent" | "org"
  payload_type: string | null
  auto_decision: "approve" | "reject"
  enabled: boolean
  predicate: Record<string, unknown>
}

type ResolutionTier = "agent_owned" | "agent_grant" | "org_default" | "platform_default" | "missing"

interface CapabilityProviderRow {
  provider: string
  label: string
  note: string
  kind: string | null
  resolution: {
    tier: ResolutionTier
    credential_id: number | null
    credential_name: string | null
  }
}

interface CapabilityOverview {
  key: string
  label: string
  blurb: string
  enabled: boolean
  provider: string
  available_providers: string[]
  providers: CapabilityProviderRow[]
  active_provider: string | null
}

interface CredentialFieldDef {
  key: string
  label: string
  sensitive?: boolean
  optional?: boolean
  multiline?: boolean
  primary?: boolean
}

interface Props {
  agent: Agent
  agents: AgentSummary[]
  org_credentials?: OrgCredential[]
  granted_credential_ids?: number[]
  approval_rules?: AgentApprovalRule[]
  capabilities_overview?: CapabilityOverview[]
  credential_field_schemas?: Record<string, CredentialFieldDef[]>
}

export default function AgentEdit({
  agent,
  agents = [],
  org_credentials = [],
  granted_credential_ids = [],
  approval_rules = [],
  capabilities_overview = [],
  credential_field_schemas = {},
}: Props) {
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
    // Per-agent credential allowlist. Empty = use org defaults (the
    // controller treats "no rows" as "all credentials in scope"). Any
    // selection narrows the agent to those specific credentials.
    granted_credential_ids: granted_credential_ids,
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

  type TabKey = "identity" | "behavior" | "permissions" | "capabilities" | "approvals"
  const VALID_TABS: TabKey[] = ["identity", "behavior", "permissions", "capabilities", "approvals"]
  // Tab state mirrors ?tab=… so refresh / share / deep-link work.
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "identity"
    const raw = new URL(window.location.href).searchParams.get("tab")
    return (VALID_TABS as string[]).includes(raw ?? "") ? (raw as TabKey) : "identity"
  })
  function selectTab(next: TabKey) {
    setTab(next)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (next === "identity") url.searchParams.delete("tab")
    else url.searchParams.set("tab", next)
    window.history.replaceState({}, "", url.toString())
  }
  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: "identity",     label: "Identity" },
    { key: "behavior",     label: "Behavior" },
    { key: "permissions",  label: "Permissions" },
    { key: "capabilities", label: "Capabilities" },
    { key: "approvals",    label: "Approvals" },
  ]
  // Child components declare agentId as number but Agent.id is a string slug
  // at runtime (e.g. "agt_KxWp…"). Cast at the boundary to avoid lying in
  // every child signature.
  const agentId = agent.id as unknown as number

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
        action={
          <div className="flex items-center gap-2">
            <ExportAgentJsonButton agentId={agent.id} agentSlug={agent.slug} />
            <PublishToCommunityButton agentId={agent.id} agentName={agent.name} />
          </div>
        }
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div className="flex items-center gap-1 rounded-md border bg-card p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
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
              placeholder={`--\n${agent.name}\n${agent.role} @ Sentrel`}
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

          <CredentialsGrantSection
            credentials={org_credentials}
            granted={data.granted_credential_ids}
            onChange={(ids) => setData("granted_credential_ids", ids)}
          />
        </section>
        </>)}

        {tab === "capabilities" && (
          <CapabilitiesTab
            agentId={agentId}
            agentSlug={agent.slug}
            overview={capabilities_overview}
            current={data.capabilities as Record<string, { enabled?: boolean; provider?: string }>}
            onChange={(key, patch) => setCap(key, patch)}
            fieldSchemas={credential_field_schemas}
          />
        )}

        {tab === "approvals" && (
          <ApprovalRulesTab agentId={agentId} rules={approval_rules} />
        )}

        <div className="flex justify-end gap-2 pb-8">
          <Button variant="outline" asChild>
            <Link href={agentPath(agentId)}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={processing}>
            {processing ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </AppLayout>
  )
}

// Renders the org's credentials grouped by kind with checkboxes for "this
// agent may use it". Empty selection means "no restriction — use org
// defaults for whichever (kind, provider) the agent needs at runtime".
function CredentialsGrantSection({
  credentials,
  granted,
  onChange,
}: {
  credentials: OrgCredential[]
  granted: number[]
  onChange: (ids: number[]) => void
}) {
  if (!credentials || credentials.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
        No org credentials yet. Add one in{" "}
        <Link href="/settings/credentials" className="underline">
          Settings → Credentials
        </Link>
        .
      </div>
    )
  }
  const grouped: Record<string, OrgCredential[]> = {}
  for (const c of credentials) (grouped[c.kind] ||= []).push(c)
  const toggle = (id: number) => {
    if (granted.includes(id)) onChange(granted.filter((x) => x !== id))
    else onChange([...granted, id])
  }
  const LABEL: Record<string, string> = {
    llm_api_key: "LLM API keys",
    cloud_provider: "Cloud providers",
    generic: "Generic secrets",
  }
  return (
    <div className="mt-6 space-y-3">
      <Overline className="mb-1">Credentials this agent may use</Overline>
      <p className="text-[10px] text-muted-foreground">
        Leave everything unchecked to fall back to org defaults. Any selection narrows
        the agent to those specific credentials only.
      </p>
      {Object.entries(grouped).map(([kind, items]) => (
        <div key={kind} className="rounded-lg border border-border p-3">
          <div className="text-xs font-semibold mb-2">{LABEL[kind] ?? kind}</div>
          <div className="space-y-1.5">
            {items.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-2 py-1"
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={granted.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="font-medium">{c.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{c.provider}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Snapshots the current agent's identity/personality/instructions/capabilities/
// Publishes this agent as v1 of a new community template. Successful save
// hits the server's AgentTemplates::Publisher → creates a versioned
// AgentTemplate with embedded skill bundles, capability config, approval
// rules, and the persona markdown. Server-side stripping handles
// credentials + channel tokens so nothing private leaks.
const LICENSES = [
  { value: "CC-BY-4.0", label: "CC-BY-4.0 (Attribution, recommended)" },
  { value: "CC0-1.0", label: "CC0-1.0 (Public domain)" },
  { value: "MIT", label: "MIT" },
  { value: "Apache-2.0", label: "Apache-2.0" },
  { value: "All rights reserved", label: "All rights reserved (no redistribution)" },
]

function PublishToCommunityButton({ agentId, agentName }: { agentId: string | number; agentName: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(`${agentName} (community)`)
  const [category, setCategory] = useState("starter")
  const [published, setPublished] = useState(true)
  const [description, setDescription] = useState("")
  const [license, setLicense] = useState("CC-BY-4.0")
  const [changelog, setChangelog] = useState("Initial publish")
  const [showStripped, setShowStripped] = useState(false)
  const [busy, setBusy] = useState(false)

  function csrf(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    fetch(`/agent_templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
      body: JSON.stringify({ agent_id: agentId, name, category, published, description, license, changelog }),
    })
      .then((res) => {
        if (res.redirected) window.location.href = res.url
        else if (!res.ok) throw new Error(`HTTP ${res.status}`)
      })
      .catch((err) => alert(`Publish failed: ${(err as Error).message}`))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <BookMarked className="size-3.5" />
        Publish to community
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="bg-background rounded-lg border border-border max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold">Publish to community</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Snapshots this agent as v1 of a portable <code className="text-[10.5px]">agent.json</code> template — persona,
                  capabilities, approval rules, and full skill bundles included.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label className="text-xs">Category</Label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {["starter","sales","support","marketing","engineering","people","personal","ops"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">License</Label>
                <select
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {LICENSES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Short description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this template is good for" />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Changelog (this version)</Label>
              <textarea
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                placeholder="What changed since the last version? (e.g. 'Tightened tone, added Stripe skill')"
              />
            </div>

            <label className="flex items-center gap-2 text-xs py-1">
              <input
                type="checkbox"
                className="size-3.5"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Visible to other workspaces (uncheck to keep private to yours)
            </label>

            <button
              type="button"
              onClick={() => setShowStripped((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {showStripped ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {showStripped ? "Hide" : "What's stripped before publishing?"}
            </button>
            {showStripped && (
              <div className="rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground space-y-1">
                <p>The exporter strips anything secret or instance-specific before the JSON leaves your workspace:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Encrypted credentials — only the credential name + provider is kept, never the secret itself</li>
                  <li>Channel tokens (email auth, Telegram bot tokens, Slack webhooks)</li>
                  <li>Conversation history, memory, audit log, spend counters</li>
                  <li>Org-wide approval rules (only this agent's per-agent rules are templated)</li>
                </ul>
                <p>Importers see <code className="text-[10.5px]">credentials_required</code> / <code className="text-[10.5px]">channels_required</code> hints and ask the user to wire up their own.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Publishing…" : "Publish v1"}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

// Triggers a browser download of the agent's current state as a portable
// agent.json file. Server returns the same Exporter payload that
// PublishToCommunityButton would persist — handy for sharing one-offs
// without creating a community template.
function ExportAgentJsonButton({ agentId, agentSlug }: { agentId: string | number; agentSlug?: string }) {
  const href = `/agents/${agentId}/export`
  return (
    <a
      href={href}
      download={agentSlug ? `${agentSlug}.agent.json` : "agent.json"}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-xs hover:bg-muted"
      title="Download this agent as a portable agent.json file"
    >
      <FileJson className="size-3.5" /> agent.json
      <Download className="size-3" />
    </a>
  )
}

// Approval rules tab on the agent edit page. Read-only summary — rules
// are still authored on /approval_rules so we don't duplicate the
// dialog code here. Lists agent-specific rules first, then org-wide
// rules that ALSO apply to this agent.
function ApprovalRulesTab({ rules }: { agentId: number; rules: AgentApprovalRule[] }) {
  const agentRules = rules.filter((r) => r.scope === "agent")
  const orgRules = rules.filter((r) => r.scope === "org")
  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <Overline className="mb-1">Approval rules</Overline>
          <p className="text-xs text-muted-foreground">
            Rules let this agent skip the human-in-the-loop for low-risk requests. Edits go via{" "}
            <Link href="/approval_rules" className="underline">/approval_rules</Link>.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/approval_rules"><Plus className="size-3.5 mr-1" /> New rule</Link>
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
          <ShieldCheck className="mx-auto mb-2 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">No rules apply to this agent</p>
          <p className="mt-1 text-xs text-muted-foreground">Every approval request will pause for a human. Add a rule on /approval_rules to auto-resolve low-risk patterns.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {agentRules.length > 0 && (
            <RuleGroup title="Agent-specific" subtitle="Match this agent before any org-wide rule">
              {agentRules.map((r) => <RuleRow key={r.id} rule={r} />)}
            </RuleGroup>
          )}
          {orgRules.length > 0 && (
            <RuleGroup title="Org-wide" subtitle="Apply to every agent — including this one">
              {orgRules.map((r) => <RuleRow key={r.id} rule={r} />)}
            </RuleGroup>
          )}
        </div>
      )}
    </section>
  )
}

function RuleGroup({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="text-[10px] text-muted-foreground/70">— {subtitle}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function RuleRow({ rule }: { rule: AgentApprovalRule }) {
  const isApprove = rule.auto_decision === "approve"
  const Icon = isApprove ? CheckCircle2 : XCircle
  const decisionColor = isApprove
    ? "text-green-700 dark:text-green-400"
    : "text-red-700 dark:text-red-400"
  return (
    <div className={`flex items-center gap-2 rounded-md border p-2 text-xs ${rule.enabled ? "" : "opacity-50"}`}>
      <Icon className={`size-3.5 ${decisionColor}`} />
      <div className="min-w-0 flex-1 truncate">
        <span className="font-medium">{rule.label || `${isApprove ? "Approve" : "Reject"} ${rule.payload_type || "any"}`}</span>
        {rule.scope === "org" && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <Building2 className="size-2.5" /> org-wide
          </span>
        )}
      </div>
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {rule.payload_type || "any"}
      </span>
      {!rule.enabled && <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">disabled</span>}
    </div>
  )
}

// ── Capabilities tab ────────────────────────────────────────────────────
//
// Per-agent view of the multi-provider capabilities (image gen, TTS, STT,
// browser, search, doc parse, video gen, code sandbox). For each one:
//   - Enabled toggle
//   - Provider select (Auto | each vendor)
//   - Per-provider key status: agent-owned / agent-grant / org-default / missing
//   - One-click "Add key for this agent" or "Add key for the whole org"
//     CTAs that deep-link to /settings/credentials with the right prefill.

const TIER_PILL: Record<ResolutionTier, { label: string; tone: string }> = {
  agent_owned:      { label: "agent-only",  tone: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30" },
  agent_grant:      { label: "granted",     tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  org_default:      { label: "org-shared",  tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  platform_default: { label: "platform",    tone: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30" },
  missing:          { label: "no key",      tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
}

function CapabilitiesTab({
  agentId,
  agentSlug,
  overview,
  current,
  onChange,
  fieldSchemas,
}: {
  agentId: number
  agentSlug: string
  overview: CapabilityOverview[]
  current: Record<string, { enabled?: boolean; provider?: string }>
  onChange: (key: string, patch: Record<string, unknown>) => void
  fieldSchemas: Record<string, CredentialFieldDef[]>
}) {
  // Track which (capability, provider, scope) row has its inline add-key
  // form expanded. Only one form open at a time keeps the tab compact.
  const [openAdder, setOpenAdder] = useState<{ cap: string; provider: string; kind: string; scope: "agent" | "org" } | null>(null)
  function isOpenFor(capKey: string, provider: string, scope: "agent" | "org") {
    return openAdder?.cap === capKey && openAdder.provider === provider && openAdder.scope === scope
  }
  function toggleAdder(capKey: string, provider: string, kind: string, scope: "agent" | "org") {
    setOpenAdder((prev) =>
      prev?.cap === capKey && prev.provider === provider && prev.scope === scope
        ? null
        : { cap: capKey, provider, kind, scope },
    )
  }

  if (overview.length === 0) {
    return (
      <section>
        <Overline className="mb-3">Capabilities</Overline>
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No capabilities to configure yet. Add keys at /settings/credentials.
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <Overline className="mb-1">Capabilities</Overline>
        <p className="text-xs text-muted-foreground">
          Each capability uses the first provider whose key resolves. Add a key just for this agent — or pull from the org's shared keys. Click "agent-only" on Add to lock a key to this agent so no sibling sees it.
        </p>
      </div>

      <div className="space-y-3">
        {overview.map((cap) => {
          const local = current[cap.key] || {}
          const enabled = local.enabled !== false
          const provider = local.provider || cap.provider || "auto"
          return (
            <div key={cap.key} className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">{cap.label}</h3>
                    {!enabled && (
                      <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">disabled</span>
                    )}
                    {enabled && cap.active_provider && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                        using {cap.active_provider}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{cap.blurb}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs">
                  <Checkbox checked={enabled} onCheckedChange={(v) => onChange(cap.key, { enabled: v === true })} />
                  Enabled
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-[11px]">Provider</Label>
                <Select value={provider} onValueChange={(v) => onChange(cap.key, { provider: v })}>
                  <SelectTrigger className="h-7 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cap.available_providers.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p === "auto" ? "Auto (cheapest available)" : p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ul className="space-y-1 border-t pt-2">
                {cap.providers.map((p) => {
                  const pill = TIER_PILL[p.resolution.tier]
                  const isActive = enabled && cap.active_provider === p.provider
                  return (
                    <li key={p.provider} className="space-y-1">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] ${pill.tone}`}>
                          {pill.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className={`font-medium ${isActive ? "text-foreground" : "text-foreground/80"}`}>{p.label}</span>
                          {p.resolution.credential_name && (
                            <span className="text-muted-foreground"> · {p.resolution.credential_name}</span>
                          )}
                        </span>
                        {p.resolution.tier === "missing" && p.kind && (
                          <span className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => toggleAdder(cap.key, p.provider, p.kind!, "agent")}
                              className={`rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted ${
                                isOpenFor(cap.key, p.provider, "agent")
                                  ? "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                                  : "bg-background"
                              }`}
                              title="Create a key visible only to this agent"
                            >
                              {isOpenFor(cap.key, p.provider, "agent") ? "Cancel" : "Add agent-only"}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleAdder(cap.key, p.provider, p.kind!, "org")}
                              className={`rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted ${
                                isOpenFor(cap.key, p.provider, "org")
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                  : "bg-background"
                              }`}
                              title="Create a key shared across the whole org"
                            >
                              {isOpenFor(cap.key, p.provider, "org") ? "Cancel" : "Add org-wide"}
                            </button>
                          </span>
                        )}
                      </div>
                      {p.resolution.tier === "missing" && isOpenFor(cap.key, p.provider, "agent") && (
                        <InlineKeyForm
                          providerSlug={p.provider}
                          providerLabel={p.label}
                          kind={p.kind!}
                          scope="agent"
                          agentSlug={agentSlug}
                          schema={lookupCredentialSchema(fieldSchemas, p.kind!, p.provider)}
                          onClose={() => setOpenAdder(null)}
                        />
                      )}
                      {p.resolution.tier === "missing" && isOpenFor(cap.key, p.provider, "org") && (
                        <InlineKeyForm
                          providerSlug={p.provider}
                          providerLabel={p.label}
                          kind={p.kind!}
                          scope="org"
                          agentSlug={agentSlug}
                          schema={lookupCredentialSchema(fieldSchemas, p.kind!, p.provider)}
                          onClose={() => setOpenAdder(null)}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
      {/* Suppress unused warning until we wire agentId-bound actions */}
      <span className="hidden">{agentId}</span>
    </section>
  )
}

// Resolve the right field schema for a (kind, provider) tuple, with the
// same fallback chain Rails uses (exact → kind-wildcard → default).
function lookupCredentialSchema(
  schemas: Record<string, CredentialFieldDef[]>,
  kind: string,
  provider: string,
): CredentialFieldDef[] {
  return schemas[`${kind}:${provider}`] || schemas[`${kind}:*`] || schemas.__default__ || [
    { key: "value", label: "Secret value", sensitive: true, primary: true },
  ]
}

// Inline "Add key" form that POSTs to /settings/credentials WITHOUT
// navigating away. Uses Inertia partial reload on success to refresh
// the capabilities_overview / org_credentials / granted_credential_ids
// props so the new key shows up immediately as agent-owned / org-shared.
function InlineKeyForm({
  providerSlug,
  providerLabel,
  kind,
  scope,
  agentSlug,
  schema,
  onClose,
}: {
  providerSlug: string
  providerLabel: string
  kind: string
  scope: "agent" | "org"
  agentSlug: string
  schema: CredentialFieldDef[]
  onClose: () => void
}) {
  const [name, setName] = useState(`${providerSlug}-${Math.random().toString(36).slice(2, 5)}`)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [revealMap, setRevealMap] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  function csrf(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const payload = {
      credential: {
        kind,
        provider: providerSlug,
        name,
        fields,
        meta: {},
        ...(scope === "agent" ? { agent_id: agentSlug } : {}),
      },
    }
    router.post("/settings/credentials", payload, {
      headers: { "X-CSRF-Token": csrf() },
      preserveScroll: true,
      onFinish: () => setBusy(false),
      onSuccess: () => {
        // Refresh the capability overview + grant list so the new key
        // immediately surfaces in this same tab.
        router.reload({ only: ["capabilities_overview", "org_credentials", "granted_credential_ids"] })
        onClose()
      },
    })
  }

  const scopeChip = scope === "agent"
    ? <span className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">agent-only</span>
    : <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">org-wide</span>

  return (
    <form onSubmit={submit} className="ml-6 mt-1 rounded-md border bg-muted/30 p-3 space-y-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Add {providerLabel} key</span>
        {scopeChip}
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Name</Label>
        <Input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {schema.map((f) => {
        const revealed = !f.sensitive || revealMap[f.key]
        return (
          <div key={f.key} className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">
                {f.label}
                {f.optional && <span className="ml-1 text-muted-foreground font-normal">optional</span>}
              </Label>
              {f.sensitive && !f.multiline && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setRevealMap((m) => ({ ...m, [f.key]: !m[f.key] }))}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {revealed ? "Hide" : "Show"}
                </button>
              )}
            </div>
            {f.multiline ? (
              <textarea
                required={!f.optional}
                value={fields[f.key] || ""}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                rows={4}
                className="w-full rounded border bg-background px-2 py-1.5 text-[11px] font-mono"
              />
            ) : (
              <Input
                required={!f.optional}
                type={f.sensitive && !revealed ? "password" : "text"}
                value={fields[f.key] || ""}
                onChange={(e) => setFields((p) => ({ ...p, [f.key]: e.target.value }))}
                className="h-7 text-xs"
              />
            )}
          </div>
        )
      })}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-7 text-xs" disabled={busy}>
          {busy ? "Saving…" : "Save key"}
        </Button>
      </div>
    </form>
  )
}
