import { Head, router } from "@inertiajs/react"
import { useEffect, useMemo, useState } from "react"
import {
  KeyRound,
  Plus,
  Trash2,
  Pencil,
  Cloud,
  Sparkles,
  Lock,
  RotateCw,
  Search,
  Check,
  ArrowLeft,
  Eye,
  EyeOff,
  ChevronRight,
  Zap,
  Image as ImageIcon,
  Volume2,
  Mic,
  Globe,
  FileText,
  Film,
  Code2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type Kind = "llm_api_key" | "cloud_provider" | "generic"

interface FieldDef {
  key: string
  label: string
  sensitive?: boolean
  optional?: boolean
  multiline?: boolean
  primary?: boolean
}

interface Credential {
  id: number
  kind: Kind
  provider: string
  name: string
  display_suffix: string
  last_used_at: string | null
  agent_grants_count: number
  dependent_agent_count: number
  dependent_scope: "granted" | "org_default"
  field_names: string[]
  meta: Record<string, unknown>
  created_at: string
}

interface CapabilityProviderRow {
  provider: string
  label: string
  kind: Kind | null
  note: string
  has_key: boolean
  always_available: boolean
}

interface CapabilityCard {
  key: string
  label: string
  blurb: string
  providers: CapabilityProviderRow[]
  active: boolean
}

interface Props {
  credentials: Credential[]
  kinds: Kind[]
  providers: Record<Kind, string[]>
  field_schemas: Record<string, FieldDef[]>
  capabilities: CapabilityCard[]
}

const CAPABILITY_ICONS: Record<string, typeof KeyRound> = {
  image_generation: ImageIcon,
  tts: Volume2,
  stt: Mic,
  browser_access: Globe,
  web_search: Search,
  doc_parse: FileText,
  video_generation: Film,
  code_sandbox: Code2,
}

const KIND_LABEL: Record<Kind, string> = {
  llm_api_key: "LLM API keys",
  cloud_provider: "Cloud providers",
  generic: "Generic secrets",
}

const KIND_ICON: Record<Kind, typeof KeyRound> = {
  llm_api_key: Sparkles,
  cloud_provider: Cloud,
  generic: Lock,
}

const KIND_BLURB: Record<Kind, string> = {
  llm_api_key:
    "Auto-piped into each agent's runtime env so usage bills to your account.",
  cloud_provider:
    "Reachable from agent code via the secrets.get tool — keys that let agents act on your cloud.",
  generic: "Any other API key your agents need. Same secrets.get access pattern.",
}

// Provider-specific brand color + short blurb shown on the picker grid.
// Keys are lowercase provider slugs; missing → falls through to the generic
// kind tint so an unknown provider still looks intentional.
const PROVIDER_META: Record<string, { tint: string; blurb: string; aka?: string }> = {
  anthropic:    { tint: "bg-orange-500/10 text-orange-600 border-orange-500/20",  blurb: "Claude models" },
  openai:       { tint: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", blurb: "GPT-5, GPT-4o" },
  openrouter:   { tint: "bg-violet-500/10 text-violet-600 border-violet-500/20",  blurb: "Many providers, one key" },
  google_ai:    { tint: "bg-sky-500/10 text-sky-600 border-sky-500/20",            blurb: "Gemini" },
  groq:         { tint: "bg-amber-500/10 text-amber-600 border-amber-500/20",      blurb: "Fast inference" },
  mistral:      { tint: "bg-rose-500/10 text-rose-600 border-rose-500/20",         blurb: "Mistral / Codestral" },
  together:     { tint: "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/20",blurb: "Open-weight hosting" },
  xai:          { tint: "bg-slate-500/10 text-slate-600 border-slate-500/20",      blurb: "Grok" },

  aws:          { tint: "bg-amber-500/10 text-amber-600 border-amber-500/20",      blurb: "Access Key + Secret + Region" },
  gcp:          { tint: "bg-blue-500/10 text-blue-600 border-blue-500/20",         blurb: "Service Account JSON" },
  azure:        { tint: "bg-sky-500/10 text-sky-600 border-sky-500/20",            blurb: "Client + Secret + Tenant" },
  heroku:       { tint: "bg-violet-500/10 text-violet-600 border-violet-500/20",   blurb: "API Key" },
  hetzner:      { tint: "bg-red-500/10 text-red-600 border-red-500/20",            blurb: "Cloud API Token" },
  vercel:       { tint: "bg-zinc-700/10 text-zinc-700 border-zinc-700/20 dark:text-zinc-300", blurb: "PAT + Team" },
  digitalocean: { tint: "bg-blue-500/10 text-blue-500 border-blue-500/20",         blurb: "API Token" },
  fly:          { tint: "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/20",blurb: "API Token" },
  cloudflare:   { tint: "bg-orange-500/10 text-orange-500 border-orange-500/20",   blurb: "API Token + Account" },

  stripe:       { tint: "bg-violet-500/10 text-violet-600 border-violet-500/20",   blurb: "Secret + Publishable + Webhook" },
  twilio:       { tint: "bg-red-500/10 text-red-600 border-red-500/20",            blurb: "Account SID + Auth Token" },
  sendgrid:     { tint: "bg-blue-500/10 text-blue-600 border-blue-500/20",         blurb: "API Key" },
  mailgun:      { tint: "bg-orange-500/10 text-orange-500 border-orange-500/20",   blurb: "API Key + Domain" },
  composio:     { tint: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",   blurb: "Composio API Key" },
  resend:       { tint: "bg-zinc-700/10 text-zinc-700 border-zinc-700/20 dark:text-zinc-300", blurb: "API Key" },
  slack:        { tint: "bg-purple-500/10 text-purple-600 border-purple-500/20",   blurb: "Bot Token" },
  notion:       { tint: "bg-zinc-700/10 text-zinc-700 border-zinc-700/20 dark:text-zinc-300", blurb: "Integration Token" },
  github:       { tint: "bg-zinc-700/10 text-zinc-700 border-zinc-700/20 dark:text-zinc-300", blurb: "Personal Access Token" },
  gitlab:       { tint: "bg-orange-500/10 text-orange-600 border-orange-500/20",   blurb: "Personal Access Token" },
  linear:       { tint: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",   blurb: "API Key" },
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google_ai: "Google AI",
  groq: "Groq",
  mistral: "Mistral",
  together: "Together",
  xai: "xAI",
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Azure",
  heroku: "Heroku",
  hetzner: "Hetzner",
  vercel: "Vercel",
  digitalocean: "DigitalOcean",
  fly: "Fly.io",
  cloudflare: "Cloudflare",
  stripe: "Stripe",
  twilio: "Twilio",
  sendgrid: "SendGrid",
  mailgun: "Mailgun",
  composio: "Composio",
  resend: "Resend",
  slack: "Slack",
  notion: "Notion",
  github: "GitHub",
  gitlab: "GitLab",
  linear: "Linear",
}

function providerLabel(slug: string): string {
  return PROVIDER_LABEL[slug] || slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function providerInitials(slug: string): string {
  const label = providerLabel(slug)
  const parts = label.split(/[\s.]+/).filter(Boolean)
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || label[0].toUpperCase()
}

function providerTint(slug: string, kind: Kind): string {
  return (
    PROVIDER_META[slug]?.tint ||
    (kind === "llm_api_key"
      ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
      : kind === "cloud_provider"
      ? "bg-sky-500/10 text-sky-600 border-sky-500/20"
      : "bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-300")
  )
}

function csrf(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
}

function lookupSchema(schemas: Record<string, FieldDef[]>, kind: Kind, provider: string): FieldDef[] {
  return schemas[`${kind}:${provider}`] || schemas[`${kind}:*`] || schemas.__default__ || [
    { key: "value", label: "Secret value", sensitive: true, primary: true },
  ]
}

export default function CredentialsPage({ credentials, kinds, providers, field_schemas, capabilities }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Credential | null>(null)
  // When the user clicks "Add key" on a capability card, we prefill the
  // modal's kind+provider and jump straight to the form step.
  const [prefill, setPrefill] = useState<{ kind: Kind; provider: string } | null>(null)
  function openWithPrefill(kind: Kind, provider: string) {
    setPrefill({ kind, provider })
    setAddOpen(true)
  }
  const grouped = useMemo(() => {
    const g: Record<Kind, Credential[]> = { llm_api_key: [], cloud_provider: [], generic: [] }
    for (const c of credentials) g[c.kind].push(c)
    return g
  }, [credentials])

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Settings", href: "/settings" },
        { label: "Credentials" },
      ]}
    >
      <Head title="Credentials" />

      <PageHeader
        eyebrow="Settings"
        title="Credentials"
        description="Store API keys and cloud secrets once; agents reuse them via env (LLM keys) or the secrets.get tool."
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Add credential
          </Button>
        }
      />

      <div className="max-w-3xl space-y-8">
        <CapabilitiesSection capabilities={capabilities} onAddKey={openWithPrefill} />

        {kinds.map((kind) => {
          const Icon = KIND_ICON[kind]
          const items = grouped[kind] ?? []
          return (
            <section key={kind}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <h2 className="font-semibold text-sm">{KIND_LABEL[kind]}</h2>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">{KIND_BLURB[kind]}</p>

              {items.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-5 text-center text-xs text-muted-foreground">
                    None yet ·{" "}
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      add one
                    </button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-1.5">
                  {items.map((c) => (
                    <CredentialRow
                      key={c.id}
                      cred={c}
                      onEdit={() => setEditing(c)}
                      onDelete={() => {
                        // Spell out the blast radius so deletes can't be
                        // muscle-memoried away — agents WILL restart.
                        const n = c.dependent_agent_count
                        const scope = c.dependent_scope === "granted"
                          ? `${n} agent${n === 1 ? "" : "s"} explicitly granted this key`
                          : `every agent in this workspace (${n}) — it's the default ${c.provider} key`
                        const msg = `Delete ${providerLabel(c.provider)} credential “${c.name}”?\n\nThis will restart ${scope} so they re-pull config. In-flight runs are interrupted.`
                        if (!confirm(msg)) return
                        router.delete(`/settings/credentials/${c.id}`)
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {addOpen && (
        <CredentialModal
          providers={providers}
          fieldSchemas={field_schemas}
          onClose={() => { setAddOpen(false); setPrefill(null) }}
          mode="create"
          prefillKind={prefill?.kind}
          prefillProvider={prefill?.provider}
        />
      )}
      {editing && (
        <CredentialModal
          providers={providers}
          fieldSchemas={field_schemas}
          onClose={() => setEditing(null)}
          mode="edit"
          cred={editing}
        />
      )}
    </AppLayout>
  )
}

function CredentialRow({ cred, onEdit, onDelete }: { cred: Credential; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card className="border-border/60 hover:border-border transition-colors">
      <CardContent className="py-3 flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
            providerTint(cred.provider, cred.kind),
          )}
        >
          {providerInitials(cred.provider)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">{cred.name}</span>
            <Badge variant="secondary" className="text-[10px]">{providerLabel(cred.provider)}</Badge>
            {cred.agent_grants_count > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {cred.agent_grants_count} {cred.agent_grants_count === 1 ? "agent" : "agents"}
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-3">
            <span className="font-mono">…{cred.display_suffix}</span>
            {cred.field_names.length > 1 && (
              <span>{cred.field_names.length} fields</span>
            )}
            {cred.last_used_at && <span>used {timeAgo(cred.last_used_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit} title="Rotate / rename">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDelete} title="Delete">
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = (Date.now() - then) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

function CredentialModal({
  providers,
  fieldSchemas,
  onClose,
  mode,
  cred,
  prefillKind,
  prefillProvider,
}: {
  providers: Record<Kind, string[]>
  fieldSchemas: Record<string, FieldDef[]>
  onClose: () => void
  mode: "create" | "edit"
  cred?: Credential
  prefillKind?: Kind
  prefillProvider?: string
}) {
  // Two-step flow on create: pick provider, then fill the form. When a
  // capability card prefills kind+provider, skip the pick step and jump
  // straight to the form. Edit always opens the form directly.
  const initialStep: "pick" | "form" =
    mode === "edit" || prefillProvider ? "form" : "pick"
  const [step, setStep] = useState<"pick" | "form">(initialStep)
  const [kind, setKind] = useState<Kind>(cred?.kind ?? prefillKind ?? "llm_api_key")
  const [provider, setProvider] = useState<string>(cred?.provider ?? prefillProvider ?? "")
  const [name, setName] = useState(
    cred?.name ?? (prefillProvider ? `${providerLabel(prefillProvider).toLowerCase()}-${randomTag()}` : ""),
  )
  const [fields, setFields] = useState<Record<string, string>>({})
  const [revealMap, setRevealMap] = useState<Record<string, boolean>>({})
  const [baseUrl, setBaseUrl] = useState<string>((cred?.meta?.base_url as string) ?? "")
  const [usageMd, setUsageMd] = useState<string>((cred?.meta?.usage_md as string) ?? "")
  const [busy, setBusy] = useState(false)

  const schema = useMemo<FieldDef[]>(
    () => lookupSchema(fieldSchemas, kind, provider),
    [fieldSchemas, kind, provider],
  )

  // Reset field values when provider changes so AWS keys don't leak into
  // a Heroku payload. base_url + usage_md are user-typed context, not
  // secret material, so they survive the provider switch.
  useEffect(() => {
    setFields({})
    setRevealMap({})
  }, [kind, provider])

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  function toggleReveal(key: string) {
    setRevealMap((m) => ({ ...m, [key]: !m[key] }))
  }

  function pickProvider(nextKind: Kind, nextProvider: string) {
    setKind(nextKind)
    setProvider(nextProvider)
    setName((prev) => prev || `${providerLabel(nextProvider).toLowerCase()}-${randomTag()}`)
    setStep("form")
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const meta: Record<string, string> = {}
    if (baseUrl.trim()) meta.base_url = baseUrl.trim()
    if (usageMd.trim()) meta.usage_md = usageMd.trim()
    const payload = { credential: { kind, provider, name, fields, meta } }
    if (mode === "create") {
      router.post("/settings/credentials", payload, {
        headers: { "X-CSRF-Token": csrf() },
        onFinish: () => setBusy(false),
        onSuccess: onClose,
      })
    } else if (cred) {
      router.patch(`/settings/credentials/${cred.id}`, payload, {
        headers: { "X-CSRF-Token": csrf() },
        onFinish: () => setBusy(false),
        onSuccess: onClose,
      })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            {mode === "create" && step === "form" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 -ml-2"
                onClick={() => setStep("pick")}
                aria-label="Back to provider list"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {step === "form" && provider && (
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-md border text-[11px] font-semibold",
                  providerTint(provider, kind),
                )}
              >
                {providerInitials(provider)}
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle className="text-base">
                {mode === "create"
                  ? step === "pick"
                    ? "Add credential"
                    : `Add ${providerLabel(provider)} credential`
                  : `Rotate ${cred?.name}`}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {mode === "create"
                  ? step === "pick"
                    ? "Pick the service first. We'll show the right fields."
                    : "Stored encrypted at rest. Agents read via env or secrets.get."
                  : "Leave a field blank to keep its current value."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === "pick" ? (
          <ProviderPicker
            providers={providers}
            onPick={pickProvider}
          />
        ) : (
          <form onSubmit={submit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input
                required
                placeholder={`${providerLabel(provider).toLowerCase()}-prod`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Friendly label, unique per provider. Used by agents to distinguish prod vs staging.
              </p>
            </div>

            <div className="border-t border-border/60 pt-4 space-y-3">
              {schema.map((f) => {
                const revealed = !f.sensitive || revealMap[f.key]
                return (
                  <div key={f.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">
                        {f.label}
                        {f.optional && <span className="text-muted-foreground font-normal"> · optional</span>}
                      </Label>
                      {f.sensitive && !f.multiline && (
                        <button
                          type="button"
                          onClick={() => toggleReveal(f.key)}
                          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                          {revealed ? "Hide" : "Show"}
                        </button>
                      )}
                    </div>
                    {f.multiline ? (
                      <textarea
                        required={mode === "create" && !f.optional}
                        rows={5}
                        autoComplete={f.sensitive ? "new-password" : "off"}
                        value={fields[f.key] || ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                        placeholder={mode === "edit" ? "(unchanged)" : f.sensitive ? '{\n  "type": "service_account",\n  ...\n}' : ""}
                      />
                    ) : (
                      <Input
                        type={revealed ? "text" : "password"}
                        autoComplete={f.sensitive ? "new-password" : "off"}
                        required={mode === "create" && !f.optional}
                        placeholder={mode === "edit" ? "(unchanged)" : ""}
                        value={fields[f.key] || ""}
                        onChange={(e) => setField(f.key, e.target.value)}
                        className="font-mono text-xs"
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Context the agent reads at runtime. base_url tells secrets.get
                consumers where to POST; usage_md is a short markdown blob
                describing what the credential is for and how to use it (auth
                header shape, slug rules, idempotency hints). Without this,
                agents get a raw key and have no idea what to do with it. */}
            <div className="border-t border-border/60 pt-4 space-y-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Agent context · shown when an agent fetches this credential
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Base URL <span className="text-muted-foreground font-normal">· optional</span>
                </Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Usage notes (markdown) <span className="text-muted-foreground font-normal">· optional but recommended</span>
                </Label>
                <textarea
                  rows={5}
                  value={usageMd}
                  onChange={(e) => setUsageMd(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                  placeholder={`Short markdown the agent reads at fetch time. E.g.:

# ScribeMD Articles API
- Base: https://api.scribemd.ai/api/v1/articles
- Auth: Bearer <api_key> in Authorization header
- POST to create, PATCH /:slug to update
- Slug rule: ^[a-z0-9-]+$
- Default published: false (draft first, then PATCH to publish)`}
                />
                <p className="text-[10px] text-muted-foreground">
                  Tell the agent what this credential is for and how to use it. Endpoint, auth shape,
                  any rules. Saves you having to repeat it in every prompt.
                </p>
              </div>
            </div>

            <DialogFooter className="-mx-6 px-6 pt-3 pb-1 border-t border-border/60">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <RotateCw className="size-3.5 animate-spin mr-1.5" />}
                {mode === "create" ? "Add credential" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Provider picker: grouped grid (LLM keys, Cloud providers, Generic) with
// brand tinting + 2-letter avatars. Search filters across both label and slug.
function ProviderPicker({
  providers,
  onPick,
}: {
  providers: Record<Kind, string[]>
  onPick: (kind: Kind, provider: string) => void
}) {
  const [query, setQuery] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  const [customSlug, setCustomSlug] = useState("")
  const [customKind, setCustomKind] = useState<Kind>("generic")

  const sections: Array<{ kind: Kind; title: string }> = [
    { kind: "llm_api_key", title: "LLM API keys" },
    { kind: "cloud_provider", title: "Cloud providers" },
    { kind: "generic", title: "Generic secrets" },
  ]

  const q = query.trim().toLowerCase()
  const filtered = sections.map((s) => ({
    ...s,
    items: providers[s.kind].filter((p) => {
      if (!q) return true
      return p.toLowerCase().includes(q) || providerLabel(p).toLowerCase().includes(q)
    }),
  }))

  const noMatches = filtered.every((s) => s.items.length === 0)

  return (
    <div className="px-6 py-4 max-h-[70vh] overflow-y-auto space-y-5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search providers — aws, stripe, openai…"
          className="pl-8 h-9"
        />
      </div>

      {filtered.map(
        (s) =>
          s.items.length > 0 && (
            <section key={s.kind}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {s.title}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {s.items.map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => onPick(s.kind, p)}
                    className="group flex items-center gap-3 rounded-md border border-border/60 hover:border-border bg-card hover:bg-muted/30 px-3 py-2.5 text-left transition-colors"
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
                        providerTint(p, s.kind),
                      )}
                    >
                      {providerInitials(p)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{providerLabel(p)}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {PROVIDER_META[p]?.blurb ?? p}
                      </div>
                    </div>
                    <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </section>
          ),
      )}

      {noMatches && (
        <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          No matching providers.
          {!customOpen && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => { setCustomOpen(true); setCustomSlug(query) }}
                className="text-foreground underline-offset-2 hover:underline"
              >
                Add a custom one
              </button>
              .
            </>
          )}
        </div>
      )}

      <details
        open={customOpen}
        onToggle={(e) => setCustomOpen((e.target as HTMLDetailsElement).open)}
        className="rounded-md border border-border/60 bg-muted/20"
      >
        <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none flex items-center justify-between">
          <span>Custom provider</span>
          <span className="text-[10px] text-muted-foreground">type the slug yourself</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          <div className="flex gap-2">
            <select
              value={customKind}
              onChange={(e) => setCustomKind(e.target.value as Kind)}
              className="rounded-md border border-input bg-background px-2 text-xs h-8"
            >
              <option value="llm_api_key">LLM key</option>
              <option value="cloud_provider">Cloud</option>
              <option value="generic">Generic</option>
            </select>
            <Input
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value)}
              placeholder="provider-slug"
              className="h-8 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={!customSlug.trim()}
              onClick={() => onPick(customKind, customSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_"))}
            >
              <Check className="size-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Falls back to a single-field “Secret value” form. Add per-provider schemas in
            <span className="font-mono"> app/models/credential.rb</span> for richer inputs.
          </p>
        </div>
      </details>
    </div>
  )
}

function randomTag(): string {
  return Math.random().toString(36).slice(2, 5)
}

// ── Capabilities overview ────────────────────────────────────────────────
//
// At-a-glance section above the raw credentials list. For each
// capability we offer (image gen / TTS / STT / browser / web search /
// doc parse / video gen / code sandbox), shows which providers have
// a configured key and which don't, with one-click "Add" CTAs that open
// the credential modal prefilled with the right kind+provider.

function CapabilitiesSection({
  capabilities,
  onAddKey,
}: {
  capabilities: CapabilityCard[]
  onAddKey: (kind: Kind, provider: string) => void
}) {
  const activeCount = capabilities.filter((c) => c.active).length
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Capabilities</h2>
          <span className="text-xs text-muted-foreground">{activeCount} of {capabilities.length} active</span>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Each capability uses the first provider whose key resolves. Add a key for any provider in the row to enable that capability — your agents pick it up on next run.
      </p>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {capabilities.map((cap) => (
          <CapabilityCardItem key={cap.key} cap={cap} onAddKey={onAddKey} />
        ))}
      </div>
    </section>
  )
}

function CapabilityCardItem({
  cap,
  onAddKey,
}: {
  cap: CapabilityCard
  onAddKey: (kind: Kind, provider: string) => void
}) {
  const Icon = CAPABILITY_ICONS[cap.key] || KeyRound
  return (
    <Card className={cap.active ? "border-border" : "border-dashed border-border/60"}>
      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-md border ${
              cap.active
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold">{cap.label}</h3>
              {cap.active ? (
                <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-2.5" /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  <AlertCircle className="size-2.5" /> No key
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{cap.blurb}</p>
          </div>
        </div>

        <ul className="space-y-1 border-t pt-2">
          {cap.providers.map((p) => (
            <li key={p.provider} className="flex items-center gap-2 text-[11px]">
              {p.has_key ? (
                <CheckCircle2 className="size-3 shrink-0 text-emerald-600" />
              ) : (
                <span className="size-3 shrink-0 rounded-full border border-muted-foreground/30" />
              )}
              <span className={`min-w-0 flex-1 truncate ${p.has_key ? "" : "text-muted-foreground"}`}>
                <span className="font-medium text-foreground">{p.label}</span>
                {p.note && <span className="text-muted-foreground"> — {p.note}</span>}
              </span>
              {!p.has_key && !p.always_available && p.kind && (
                <button
                  type="button"
                  onClick={() => onAddKey(p.kind!, p.provider)}
                  className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted"
                >
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
