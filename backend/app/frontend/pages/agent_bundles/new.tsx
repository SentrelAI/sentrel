import { Head, router, useForm } from "@inertiajs/react"
import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle, BookOpen, Check, ChevronDown, Circle, Clock, FolderGit2, KeyRound, Plug, Plus, Radio, Rocket, Search, Sparkle, Target, Terminal, Trash2, Wrench,
} from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GoogleSignInButton } from "@/components/google-sign-in-button"
import { LandingNav } from "@/components/landing/landing-nav"
import { userSessionPath, userRegistrationPath } from "@/routes"
import { MarkdownEditor } from "@/components/markdown-editor"
import { slugify } from "@/lib/random-names"
import { MODELS_BY_PROVIDER } from "@/lib/model-catalog"
import { describeCron, CRON_PRESETS, timezoneOptions } from "@/lib/cron-describe"
import { TimezoneSelect, isTimezoneInput } from "@/components/timezone-select"
import { ConnectModal, type CatalogApp } from "@/components/integrations/connect-modal"

// The shareable "Deploy to sentrel" wizard.
//   /deploy-agent?source=https://github.com/owner/repo[/tree/ref/subdir]
// Server fetches + validates the bundle; this page renders it as a fully
// EDITABLE form — rename, change model, edit the goal, rewrite any persona
// block (with {{variable}} chips, same editor as the agent Identity tab) —
// then POSTs the merged result to /agent_bundles.
//
// Two targets: create a new agent, or pick an existing one to REDEPLOY
// the bundle onto (posts agent_id; server runs AgentBundles::Updater).
// ?agent_id= preselects update mode for deep links from an agent page.

interface Preview {
  name: string
  role: string
  description: string
  goal: { mission?: string; kpis?: Array<Record<string, number>>; definition_of_done?: string } | null
  model: { provider?: string; id?: string; model_id?: string }
  persona: { identity_md: string | null; personality_md: string | null; instructions_md: string | null }
  skills: Array<{ slug: string; file_count: number; skill_md: string }>
  knowledge: Array<{ path: string; why: string | null; bytes: number }>
  channels: Array<{ type: string; why: string | null }>
  schedules: Array<{ name: string; cron: string; timezone: string | null; why: string | null; instruction: string | null }>
  inputs: Array<{ key: string; label: string; description: string | null; placeholder: string | null; default: string | null; required: boolean }>
  webhooks: Array<{ name: string; source: string; instruction: string; why: string | null }>
  integrations: Array<
    | { service: string; kind: "service" | "mcp"; required?: boolean; why: string | null; options?: never }
    | { kind: "choice"; options: string[]; multi?: boolean; required?: boolean; why: string | null; service?: never }
  >
  secrets: string[]
  permissions: Record<string, string>
}

interface PlatformSkill {
  slug: string
  name: string
  category: string
  description: string
  requires_connections: string[]
}

interface ScheduleRow {
  name: string
  cron: string
  timezone: string
  instruction: string
}

interface ExistingAgent {
  id: string
  name: string
  slug: string
}

interface Props {
  source: string
  // Set when the bundle arrived via `npx agentmanifest deploy` — the CLI
  // uploaded it to a short-lived server-side cache and opened this page
  // with ?upload=<token>; deploy posts the token instead of a GitHub URL.
  upload: string | null
  preview: Preview | null
  error: string | null
  connected_services: string[]
  credential_providers: string[]
  platform_skills: PlatformSkill[]
  agents: ExistingAgent[]
  agent_id: string | null
  // false → anonymous visitor: full preview renders behind a sign-in
  // overlay; Deploy/Connect open the overlay instead of acting.
  authenticated?: boolean
  integration_catalog?: CatalogApp[]
  nango_connect_base_url?: string | null
  org_email_domain?: string | null
  managed_email_zone?: string | null
  suggested_email_label?: string | null
}

// "APOLLO_API_KEY" / "apollo-token" → "apollo" — same normalization the
// engine's secrets tool uses, so the saved credential resolves for the
// agent at runtime.
function providerFromSecretName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]?(api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token|token|key|secret)$/i, "")
    .replace(/[_-]+$/, "")
    .replace(/_/g, "-") || name.toLowerCase()
}

function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
}

// Service-name comparisons must survive naming drift between catalog
// slugs ("googlecalendar") and stored service_names
// ("google_calendar", "GOOGLECALENDAR") — normalize to lowercase
// alphanumerics before comparing, mirroring Deployer#normalize_service.
const normSvc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

interface KpiRow {
  key: string
  value: string
}

export default function DeployAgent({ source, upload, preview, error, connected_services, credential_providers, platform_skills, agents, agent_id, authenticated = true, integration_catalog = [], nango_connect_base_url = null, org_email_domain = null, managed_email_zone = null, suggested_email_label = null }: Props) {
  const [url, setUrl] = useState(source)
  // Deploy target: create a fresh agent, or redeploy the bundle onto an
  // existing one (spec-owned fields update in place; the agent keeps its
  // name, slug, memory and anything added outside the bundle). An agent
  // whose slug matches the bundle was probably deployed from it — that's
  // the default pick for update mode.
  const slugMatch = preview ? agents.find((a) => a.slug === slugify(preview.name)) : undefined
  const [mode, setMode] = useState<"create" | "update">(agent_id ? "update" : "create")
  const [targetAgentId, setTargetAgentId] = useState(agent_id || slugMatch?.id || agents[0]?.id || "")
  const updating = mode === "update" && targetAgentId !== ""
  const targetAgent = agents.find((a) => a.id === targetAgentId)
  const [agentName, setAgentName] = useState(preview?.name || "")
  const [agentSlug, setAgentSlug] = useState(preview ? slugify(preview.name) : "")
  const [agentRole, setAgentRole] = useState(preview?.role || "")
  const [provider, setProvider] = useState(preview?.model?.provider || "anthropic")
  const [modelId, setModelId] = useState(preview?.model?.id || preview?.model?.model_id || "claude-sonnet-4-6")
  const [mission, setMission] = useState(preview?.goal?.mission || "")
  const [definitionOfDone, setDefinitionOfDone] = useState(preview?.goal?.definition_of_done || "")
  const [kpis, setKpis] = useState<KpiRow[]>(
    (preview?.goal?.kpis || []).map((kpi) => {
      const [k, v] = Object.entries(kpi)[0] || ["", ""]
      return { key: k, value: String(v) }
    }),
  )
  const [identityMd, setIdentityMd] = useState(preview?.persona?.identity_md || "")
  const [personalityMd, setPersonalityMd] = useState(preview?.persona?.personality_md || "")
  const [instructionsMd, setInstructionsMd] = useState(preview?.persona?.instructions_md || "")
  // Workspace email domain, claimable inline. Local state so a successful
  // claim flips the email row live without a reload.
  const [orgDomain, setOrgDomain] = useState<string | null>(org_email_domain)
  const [claimLabel, setClaimLabel] = useState(suggested_email_label || "")
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  async function claimSubdomain() {
    if (!claimLabel.trim() || !managed_email_zone) return
    setClaimBusy(true)
    setClaimError(null)
    try {
      const res = await fetch("/settings/claim_managed_subdomain", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({ label: claimLabel.trim(), zone: managed_email_zone }),
      })
      if (res.ok || res.redirected) {
        setOrgDomain(`${claimLabel.trim().toLowerCase()}.${managed_email_zone}`)
      } else {
        const body = await res.json().catch(() => ({}))
        setClaimError(body.error || "Couldn't claim that name — try another.")
      }
    } catch (err) {
      setClaimError((err as Error).message)
    } finally {
      setClaimBusy(false)
    }
  }

  const detectedTz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" } catch { return "UTC" }
  })()
  const [schedules, setSchedules] = useState<ScheduleRow[]>(
    (preview?.schedules || []).map((s) => ({
      name: s.name,
      cron: s.cron,
      // Bundles declare "{{timezone}}" against the timezone input — resolve
      // to the visitor's detected zone so the select shows a real value
      // instead of an unmatchable token.
      timezone: !s.timezone || s.timezone.includes("{{") ? detectedTz : s.timezone,
      instruction: s.instruction || "",
    })),
  )
  // Deploy-time inputs declared by the bundle ({{key}} substitution
  // targets, e.g. github_repos). Seeded from each input's default.
  const bundleInputs = preview?.inputs || []
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    Object.fromEntries(bundleInputs.map((i) => [
      i.key,
      i.default || (isTimezoneInput(i) ? detectedTz : ""),
    ])),
  )

  // any_of integration groups: the user picks ONE alternative per group
  // (e.g. which calendar to use). Default = the first option that's
  // already connected in the org, else the first option.
  const choiceGroups = (preview?.integrations || []).filter((i) => i.kind === "choice") as Array<{ kind: "choice"; options: string[]; multi?: boolean; required?: boolean; why: string | null }>
  const initialConnected = new Set(connected_services.map(normSvc))
  const [integrationChoices, setIntegrationChoices] = useState<string[]>(
    choiceGroups.map((g) => g.options.find((o) => initialConnected.has(normSvc(o))) || g.options[0]),
  )

  // Platform skills pre-ticked when their required integration is part of
  // the bundle — plain services plus the chosen alternative from each
  // any_of group. Changing a choice swaps the auto-ticked skills for
  // that group's options without touching manual picks elsewhere.
  const plainServices = (preview?.integrations || []).filter((i) => i.kind === "service").map((i) => normSvc(i.service))
  const effectiveServices = new Set([...plainServices, ...integrationChoices.map(normSvc)])
  const [pickedPlatformSkills, setPickedPlatformSkills] = useState<Set<string>>(
    new Set(
      platform_skills
        .filter((s) => s.requires_connections.some((c) => effectiveServices.has(normSvc(c))))
        .map((s) => s.slug),
    ),
  )

  function chooseIntegration(groupIdx: number, service: string) {
    const group = choiceGroups[groupIdx]
    const previous = integrationChoices[groupIdx]
    setIntegrationChoices(integrationChoices.map((c, i) => (i === groupIdx ? service : c)))
    // Swap auto-ticked skills: drop skills tied ONLY to other options of
    // this group, add skills matching the new choice.
    const groupOptions = new Set(group.options.map(normSvc))
    setPickedPlatformSkills((prev) => {
      const next = new Set(prev)
      for (const s of platform_skills) {
        const reqs = s.requires_connections.map(normSvc)
        const tiedToGroup = reqs.some((c) => groupOptions.has(c))
        if (!tiedToGroup) continue
        if (reqs.includes(normSvc(service))) next.add(s.slug)
        else if (reqs.includes(normSvc(previous || ""))) next.delete(s.slug)
      }
      return next
    })
  }

  function togglePlatformSkill(slug: string) {
    setPickedPlatformSkills((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }
  const [saveAsTemplate, setSaveAsTemplate] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  // Live connect state — seeded from org data, updated as the user
  // connects / saves inside the wizard.
  const [connected, setConnected] = useState<Set<string>>(new Set(connected_services.map(normSvc)))
  const [savedSecrets, setSavedSecrets] = useState<Set<string>>(
    new Set((preview?.secrets || []).filter((s) => credential_providers.map((p) => p.toLowerCase()).includes(providerFromSecretName(s)))),
  )
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  // Optional per-secret base_url + usage notes → stored in the credential's
  // meta so secrets.get hands the agent both the token and where to call.
  const [secretMeta, setSecretMeta] = useState<Record<string, { base_url: string; usage_md: string }>>({})
  const [secretAdvanced, setSecretAdvanced] = useState<Set<string>>(new Set())
  const [secretBusy, setSecretBusy] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  // Friendly names for non-technical users: "google_calendar" reads as
  // "Google Calendar" with its logo wherever the catalog knows the app.
  function svcEntry(service: string) {
    return integration_catalog.find((a) => normSvc(a.slug) === normSvc(service))
  }
  function svcLabel(service: string) {
    return svcEntry(service)?.label || service.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }

  // Per-verb permission levels, editable in the Boundaries step. Seeded
  // from the bundle; sent with the deploy as overrides.
  const [permissionLevels, setPermissionLevels] = useState<Record<string, string>>(
    { ...(preview?.permissions || {}) },
  )

  // Step rail state. Required steps ship open; a manual toggle pins a step
  // so auto-advance never fights the user.
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({
    details: true, goal: false, persona: false, skills: false,
    schedules: false, boundaries: false, webhooks: false, setup: true, connections: true,
  })
  const pinnedSteps = useRef<Set<string>>(new Set())
  function toggleStep(id: string) {
    pinnedSteps.current.add(id)
    setOpenSteps((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  // Connect-in-place: which service's ConnectModal is open.
  const [connectingApp, setConnectingApp] = useState<CatalogApp | null>(null)

  // Open the same 3-mode connect modal /integrations uses, right here —
  // deploy context survives, status flips live on success. Services missing
  // from the catalog (not yet supported) still fall back to /integrations.
  function connectIntegration(service: string) {
    setConnectError(null)
    const app = integration_catalog.find((a) => normSvc(a.slug) === normSvc(service))
    if (app) {
      setConnectingApp(app)
      return
    }
    window.location.href = "/integrations"
  }

  // Save a secret as an org-level generic credential. Provider derives
  // from the secret name so the agent's secrets.get resolves it later.
  // base_url + usage_md ride along in meta so self-hosted / custom
  // APIs (Listmonk, custom services) are fully usable from secrets.get —
  // the agent gets the token AND where to call it, without leaving the
  // wizard for the Settings → Credentials page.
  async function saveSecret(name: string) {
    const value = (secretValues[name] || "").trim()
    if (!value) return
    setSecretBusy(name)
    setConnectError(null)
    const m = secretMeta[name]
    const meta: Record<string, string> = {}
    if (m?.base_url?.trim()) meta.base_url = m.base_url.trim()
    if (m?.usage_md?.trim()) meta.usage_md = m.usage_md.trim()
    try {
      const res = await fetch("/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken() },
        body: JSON.stringify({
          credential: { kind: "generic", provider: providerFromSecretName(name), name: name, value: value, ...(Object.keys(meta).length ? { meta } : {}) },
        }),
      })
      if (res.ok || res.redirected) {
        setSavedSecrets((prev) => new Set([...prev, name]))
        setSecretValues((prev) => ({ ...prev, [name]: "" }))
      } else {
        setConnectError(`Couldn't save ${name} (HTTP ${res.status}).`)
      }
    } catch (err) {
      setConnectError(`Network error: ${(err as Error).message}`)
    } finally {
      setSecretBusy(null)
    }
  }

  function loadPreview() {
    router.get("/deploy-agent", { source: url.trim() }, { preserveState: false })
  }

  function handleNameChange(name: string) {
    setAgentName(name)
    setAgentSlug(slugify(name))
  }

  // Bundle-declared hard requirements: an integration (or choice group)
  // marked `required` blocks Deploy until it's connected — for groups,
  // the CHOSEN alternative is the one that must be connected. Everything
  // else stays connect-now-or-later.
  const missingRequired = [
    ...(preview?.integrations || [])
      .filter((i): i is { service: string; kind: "service"; required?: boolean; why: string | null } => i.kind === "service" && !!i.required)
      .map((i) => i.service)
      .filter((s) => !connected.has(normSvc(s))),
    ...choiceGroups.flatMap((g, gi) => {
      if (!g.required) return []
      if (g.multi) {
        // Multi group: satisfied as soon as ANY option is connected.
        return g.options.some((o) => connected.has(normSvc(o))) ? [] : ["a network"]
      }
      // Pick-one group: the chosen option must be connected.
      const chosen = integrationChoices[gi]
      return chosen && !connected.has(normSvc(chosen)) ? [chosen] : []
    }),
  ]

  // Required deploy-time inputs that are still empty also gate Deploy.
  const missingInputs = bundleInputs.filter((i) => i.required && !(inputValues[i.key] || "").trim()).map((i) => i.label)

  // Auto-advance: when the last required connection lands (a definitive
  // moment — the OAuth popup succeeded), tuck Connections away after a beat
  // and glide to whatever still blocks Deploy, or to the deploy node itself.
  // Setup never auto-collapses: its "completion" flips while the user is
  // mid-typing, and yanking a focused input away is hostile.
  const prevMissingRequired = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevMissingRequired.current
    prevMissingRequired.current = missingRequired.length
    if (prev === null || prev === 0 || missingRequired.length > 0) return
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const t = setTimeout(() => {
      if (!pinnedSteps.current.has("connections")) {
        setOpenSteps((p) => ({ ...p, connections: false }))
      }
      const target = missingInputs.length > 0 ? "#step-setup" : "#deploy-node"
      document.querySelector(target)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" })
    }, 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingRequired.length])


  function deploy() {
    setDeployError(null)
    setDeploying(true)
    router.post("/agent_bundles", {
      ...(upload ? { upload_id: upload } : { github_url: source }),
      // agent_id flips the server to redeploy mode — the bundle updates
      // this agent in place instead of creating a new one. Name/slug are
      // ignored there (redeploy never renames).
      ...(updating ? { agent_id: targetAgentId } : {}),
      agent_name: agentName.trim(),
      agent_slug: agentSlug.trim(),
      agent_role: agentRole.trim(),
      model: { provider, model_id: modelId },
      goal: {
        mission: mission.trim(),
        kpis: kpis
          .filter((k) => k.key.trim())
          .map((k) => ({ [k.key.trim()]: Number(k.value) || 0 })),
        definition_of_done: definitionOfDone.trim(),
      },
      persona: {
        identity: identityMd,
        personality: personalityMd,
        instructions: instructionsMd,
      },
      schedules: schedules.filter((s) => s.name.trim() && s.cron.trim() && s.instruction.trim()),
      platform_skill_slugs: [...pickedPlatformSkills],
      // Pick-one groups send their single chosen service; multi groups send
      // every CONNECTED option (the agent uses all of them).
      integration_choices: choiceGroups.flatMap((g, gi) =>
        g.multi ? g.options.filter((o) => connected.has(normSvc(o))) : [integrationChoices[gi]],
      ).filter(Boolean),
      inputs: inputValues,
      permissions: permissionLevels,
      save_as_template: !updating && saveAsTemplate ? "1" : "0",
    }, {
      onError: (errors) => setDeployError(Object.values(errors).join(", ") || "Deploy failed"),
      onFinish: () => setDeploying(false),
    })
  }

  // One body, two shells: the normal workspace layout when signed in, a
  // minimal public shell + sign-in overlay when not — the visitor reads
  // the full template either way.
  const pageBody = (
    <>
      <Head title={preview ? `Deploy ${preview.name}` : "Deploy agent bundle"} />
      {/* Anonymous visitors get the hero band instead — skip the in-body
          header to avoid duplicating the title. */}
      {authenticated && (
        <PageHeader
          eyebrow="Deploy"
          title={preview
            ? (updating ? `Redeploy ${targetAgent?.name || preview.name}` : `Deploy ${agentName.trim() || preview.name}`)
            : "Deploy an agent bundle"}
          description={preview
            ? (updating
              ? "The bundle's updated persona, goal, skills, schedules and knowledge replace what this agent was deployed with — its name, memory and your own additions stay."
              : "Everything below comes from the bundle and is editable — rename, adjust the goal, change the model, rewrite the persona. Deploy when it looks right.")
            : "Paste a GitHub repo containing an agent-bundle/v1 (agent.yaml at its root) to preview and deploy it."}
        />
      )}

      <div className="max-w-2xl space-y-6">
        {/* Source */}
        <section>
          <Overline className="mb-3">Source</Overline>
          {upload ? (
            <div className="rounded-lg border bg-card p-4 flex items-start gap-2.5">
              <Terminal className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm">Uploaded from your machine via <code className="font-mono text-xs">agentmanifest deploy</code>.</p>
                <p className="text-[10px] text-muted-foreground">
                  Uploads expire after 30 minutes — if Deploy complains the upload is gone, run the command again.
                </p>
              </div>
            </div>
          ) : (
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderGit2 className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); loadPreview() } }}
                  placeholder="https://github.com/owner/repo  or  …/tree/main/agents/sdr"
                  className="pl-8"
                />
              </div>
              <Button type="button" variant="outline" onClick={loadPreview} disabled={!url.trim()}>
                <Search className="size-3.5 mr-1.5" /> Load
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Public repos only. Share this page as <code className="font-mono">/deploy-agent?source=&lt;repo-url&gt;</code> — anyone in a workspace can one-click install your agent. Local folder? <code className="font-mono">npx agentmanifest deploy</code> uploads it straight here.
            </p>
          </div>
          )}
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <>
            {/* Target — create a new agent, or redeploy onto an existing one */}
            {agents.length > 0 && (
              <section>
                <Overline className="mb-3">Target</Overline>
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {([
                      { value: "create" as const, label: "Create new agent", hint: "A fresh agent from this bundle" },
                      { value: "update" as const, label: "Update existing agent", hint: "Redeploy the bundle onto a live agent" },
                    ]).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setMode(opt.value)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                          mode === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <span className={`size-3 rounded-full border shrink-0 ${mode === opt.value ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                        <span className="min-w-0">
                          <span className="font-medium block">{opt.label}</span>
                          <span className="text-[10px] text-muted-foreground block truncate">{opt.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {mode === "update" && (
                    <div className="space-y-2">
                      <Select value={targetAgentId} onValueChange={setTargetAgentId}>
                        <SelectTrigger className="w-full [&>span]:truncate"><SelectValue placeholder="Pick an agent" /></SelectTrigger>
                        <SelectContent>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              <span className="font-medium">{a.name}</span>
                              <span className="text-muted-foreground"> — {a.slug}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Persona, goal, bundle skills, declared schedules and knowledge docs are replaced from the bundle. The agent keeps its name, slug, memory, and any skills or schedules you added yourself.
                      </p>
                    </div>
                  )}
                  {mode === "create" && slugMatch && (
                    <p className="text-[10px] text-muted-foreground">
                      Heads up: <span className="font-medium">{slugMatch.name}</span> looks like it was deployed from this bundle — pick “Update existing agent” to push your changes to it instead of creating a duplicate.
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Agent details — name/slug/role/model, all editable, at the top */}
            <WizardStep id="details" title="Agent details" state={agentName.trim() ? "done" : "attention"} summary={agentName.trim() || "unnamed"} open={!!openSteps["details"]} onToggle={() => toggleStep("details")}>
              <div className="rounded-lg border bg-card p-4 space-y-4">
                {preview.description && <p className="text-xs text-muted-foreground leading-relaxed">{preview.description}</p>}
                {!updating && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="agent_name">Name</Label>
                      <Input id="agent_name" value={agentName} onChange={(e) => handleNameChange(e.target.value)} placeholder={preview.name} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="agent_slug">Slug</Label>
                      <Input id="agent_slug" value={agentSlug} onChange={(e) => setAgentSlug(e.target.value)} />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="agent_role">Role</Label>
                  <Input id="agent_role" value={agentRole} onChange={(e) => setAgentRole(e.target.value)} placeholder="e.g. Sales Development Rep" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select
                      value={provider}
                      onValueChange={(v) => {
                        setProvider(v)
                        setModelId(MODELS_BY_PROVIDER[v]?.[0]?.value || "")
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
                    <Select value={modelId} onValueChange={setModelId}>
                      <SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Pick a model" /></SelectTrigger>
                      <SelectContent>
                        {(MODELS_BY_PROVIDER[provider] || [{ value: modelId, label: modelId }]).map((m) => (
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
                  A taken slug gets a numeric suffix automatically. Variables like <code className="font-mono">{"{{agent_name}}"}</code> and <code className="font-mono">{"{{company_name}}"}</code> are filled in with your workspace's values at deploy.
                </p>
              </div>
            </WizardStep>

            {/* Goal — editable */}
            <WizardStep id="goal" title="Goal" summary={preview.goal?.kpis?.length ? `mission + ${preview.goal.kpis.length} KPIs` : "mission"} open={!!openSteps["goal"]} onToggle={() => toggleStep("goal")}>
              <div className="rounded-lg border bg-card p-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mission" className="flex items-center gap-1.5"><Target className="size-3.5" /> Mission</Label>
                  <textarea
                    id="mission"
                    rows={2}
                    value={mission}
                    onChange={(e) => setMission(e.target.value)}
                    placeholder="What this agent exists to do — leave empty for no explicit goal."
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <Label>KPIs</Label>
                  {kpis.map((kpi, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={kpi.key}
                        onChange={(e) => setKpis(kpis.map((k, j) => (j === i ? { ...k, key: e.target.value } : k)))}
                        placeholder="meetings_booked_per_week"
                        className="flex-1 font-mono text-xs"
                      />
                      <Input
                        value={kpi.value}
                        onChange={(e) => setKpis(kpis.map((k, j) => (j === i ? { ...k, value: e.target.value } : k)))}
                        placeholder="5"
                        type="number"
                        className="w-24"
                      />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setKpis(kpis.filter((_, j) => j !== i))} aria-label="Remove KPI">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setKpis([...kpis, { key: "", value: "" }])}>
                    <Plus className="size-3" /> Add KPI
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dod">Definition of done</Label>
                  <textarea
                    id="dod"
                    rows={2}
                    value={definitionOfDone}
                    onChange={(e) => setDefinitionOfDone(e.target.value)}
                    placeholder='e.g. A meeting is "booked" when the prospect confirms a calendar slot — not when they merely reply.'
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </WizardStep>

            {/* Persona — same editor as the agent Identity tab, variable chips included */}
            <WizardStep id="persona" title="Persona" summary="identity · personality · instructions" open={!!openSteps["persona"]} onToggle={() => toggleStep("persona")}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Identity</Label>
                  <MarkdownEditor value={identityMd} onChange={setIdentityMd} minHeight="120px" ariaLabel="Identity" />
                </div>
                <div className="space-y-2">
                  <Label>Personality</Label>
                  <MarkdownEditor value={personalityMd} onChange={setPersonalityMd} minHeight="120px" ariaLabel="Personality" />
                </div>
                <div className="space-y-2">
                  <Label>Instructions</Label>
                  <MarkdownEditor value={instructionsMd} onChange={setInstructionsMd} minHeight="160px" ariaLabel="Instructions" />
                </div>
              </div>
            </WizardStep>

            {/* Skills + knowledge (from the bundle — read-only) */}
            <WizardStep id="skills" title="Skills & knowledge" summary={`${preview.skills.length} bundle skill${preview.skills.length === 1 ? "" : "s"} · ${preview.knowledge.length} knowledge doc${preview.knowledge.length === 1 ? "" : "s"}`} open={!!openSteps["skills"]} onToggle={() => toggleStep("skills")}>
              <div className="rounded-lg border bg-card divide-y">
                {preview.skills.map((s) => (
                  <details key={s.slug} className="group">
                    <summary className="flex items-center gap-2 px-4 py-2.5 text-xs cursor-pointer hover:bg-muted/25">
                      <Wrench className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{s.slug}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{s.file_count} file{s.file_count === 1 ? "" : "s"}</span>
                    </summary>
                    <pre className="whitespace-pre-wrap px-4 pb-3 text-[11px] leading-relaxed text-muted-foreground">{s.skill_md}</pre>
                  </details>
                ))}
                {preview.knowledge.map((k) => (
                  <div key={k.path} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                    <BookOpen className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">{k.path}</span>
                    {k.why && <span className="text-[10px] text-muted-foreground truncate">— {k.why}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto">{Math.round(k.bytes / 1024)}KB</span>
                  </div>
                ))}
              </div>

              {platform_skills.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Platform skills — not in the bundle, installed from this workspace's catalog. Skills matching the bundle's integrations are pre-selected.
                  </p>
                  <div className="rounded-lg border bg-card divide-y max-h-64 overflow-y-auto">
                    {platform_skills.map((s) => (
                      <label key={s.slug} className="flex items-start gap-2.5 px-4 py-2 text-xs cursor-pointer hover:bg-muted/25">
                        <Checkbox checked={pickedPlatformSkills.has(s.slug)} onCheckedChange={() => togglePlatformSkill(s.slug)} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">{s.slug}</span>
                          {s.requires_connections.length > 0 && (
                            <Badge variant="outline" className="text-[9px] ml-1.5">{s.requires_connections.join(", ")}</Badge>
                          )}
                          <span className="block text-[10px] text-muted-foreground truncate">{s.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </WizardStep>

            {/* Schedules — standing cron jobs, fully editable */}
            <WizardStep id="schedules" title="Schedules" summary={`${schedules.length} scheduled routine${schedules.length === 1 ? "" : "s"}`} open={!!openSteps["schedules"]} onToggle={() => toggleStep("schedules")}>
              <p className="text-xs text-muted-foreground mb-3 max-w-lg">
                Routines the agent runs on its own — like a morning brief or a weekly report. Change when they run, remove any, or add your own.
              </p>
              <div className="space-y-3">
                {schedules.map((s, i) => {
                  const cronText = describeCron(s.cron)
                  const presetMatch = CRON_PRESETS.find((p) => p.cron === s.cron)
                  return (
                    <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <Clock className="size-4 text-muted-foreground mt-2 shrink-0" />
                        <div className="flex-1 min-w-0 space-y-2">
                          <Input
                            value={s.name}
                            onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                            placeholder="Schedule name"
                          />
                          <div className="grid grid-cols-[12rem_1fr_minmax(10rem,14rem)] gap-2">
                            <Select
                              value={presetMatch ? presetMatch.cron : "__custom__"}
                              onValueChange={(v) => {
                                if (v !== "__custom__") setSchedules(schedules.map((x, j) => (j === i ? { ...x, cron: v } : x)))
                              }}
                            >
                              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Preset" /></SelectTrigger>
                              <SelectContent>
                                {CRON_PRESETS.map((p) => (
                                  <SelectItem key={p.cron} value={p.cron}>{p.label}</SelectItem>
                                ))}
                                <SelectItem value="__custom__">Custom…</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              value={s.cron}
                              onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, cron: e.target.value } : x)))}
                              placeholder="30 8 * * 1-5"
                              className="font-mono text-xs"
                            />
                            <Select
                              value={s.timezone}
                              onValueChange={(v) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, timezone: v } : x)))}
                            >
                              <SelectTrigger className="h-9 text-xs [&>span]:truncate"><SelectValue placeholder="Timezone" /></SelectTrigger>
                              <SelectContent className="max-h-64">
                                {timezoneOptions().map((tz) => (
                                  <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <p className={`text-[11px] ${cronText ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {cronText
                              ? <>↻ {cronText} ({s.timezone || "UTC"})</>
                              : "Custom cron — couldn't parse it into plain English. Double-check minute hour day month weekday."}
                          </p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => setSchedules(schedules.filter((_, j) => j !== i))} aria-label="Remove schedule">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      <textarea
                        rows={3}
                        value={s.instruction}
                        onChange={(e) => setSchedules(schedules.map((x, j) => (j === i ? { ...x, instruction: e.target.value } : x)))}
                        placeholder="What the agent should do when this fires…"
                        className="w-full rounded-md border bg-background px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  )
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setSchedules([...schedules, { name: "", cron: "0 9 * * 1-5", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", instruction: "" }])}
                >
                  <Plus className="size-3" /> Add schedule
                </Button>
              </div>
            </WizardStep>

            {/* Permissions, translated for humans: what it does on its own vs
                what waits for your approval. The single biggest trust question a
                non-technical deployer has — answered before deploy. */}
            {Object.keys(preview.permissions || {}).length > 0 && (
              <WizardStep id="boundaries" title="Boundaries" summary={`${Object.values(permissionLevels).filter((v) => v === "ask" || v === "draft").length} actions need your approval · ${Object.values(permissionLevels).filter((v) => v === "block" || v === "never").length} never allowed`} open={!!openSteps["boundaries"]} onToggle={() => toggleStep("boundaries")}>
                <p className="text-xs text-muted-foreground mb-3 max-w-lg">
                  These come from the agent's template — what it may do on its own, and where it stops and asks you first. Adjust any of them here; you can also change them later on the agent's page.
                </p>
                <div className="rounded-lg border bg-card divide-y">
                  {Object.entries(permissionLevels).map(([verb, level]) => (
                    <div key={verb} className="flex items-center gap-2 px-4 py-2 text-xs">
                      <span className="font-medium capitalize">{verb.replace(/_/g, " ")}</span>
                      <div className="ml-auto shrink-0">
                        <Select value={level === "draft" ? "ask" : level === "never" ? "block" : level} onValueChange={(v) => setPermissionLevels((prev) => ({ ...prev, [verb]: v }))}>
                          <SelectTrigger className={`h-7 w-44 text-[11px] ${
                            level === "auto" ? "text-emerald-600 dark:text-emerald-400"
                            : level === "block" || level === "never" ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-400"}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">does on its own</SelectItem>
                            <SelectItem value="ask">asks you first</SelectItem>
                            <SelectItem value="block">never allowed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </WizardStep>
            )}

            {/* Webhooks the bundle ships — read-only preview; tokenized URLs
                are generated at deploy and live on the agent's Webhooks tab. */}
            {(preview.webhooks || []).length > 0 && (
              <WizardStep id="webhooks" title="Triggers (advanced)" summary={`${preview.webhooks.length} webhook${preview.webhooks.length === 1 ? "" : "s"}`} open={!!openSteps["webhooks"]} onToggle={() => toggleStep("webhooks")}>
                <div className="rounded-lg border bg-card divide-y">
                  {preview.webhooks.map((w) => (
                    <div key={w.name} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <Plug className="size-3.5 text-muted-foreground" />
                        <span className="font-medium">{w.name}</span>
                        <Badge variant="outline" className="text-[9px]">{w.source}</Badge>
                        {w.why && <span className="text-[10px] text-muted-foreground truncate">— {w.why}</span>}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{w.instruction}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Each gets a unique URL at deploy — copy them from the agent's Webhooks tab into the external service.
                </p>
              </WizardStep>
            )}

            {/* Setup inputs — bundle-declared deploy parameters. Each value
                substitutes {{key}} tokens across persona/knowledge/schedules
                at deploy (e.g. the repo list a bug-fixer may work in). */}
            {bundleInputs.length > 0 && (
              <WizardStep id="setup" title="Setup" state={missingInputs.length ? "attention" : "done"} summary={missingInputs.length ? `${missingInputs.length} required input${missingInputs.length === 1 ? "" : "s"} missing` : "all inputs set"} open={!!openSteps["setup"]} onToggle={() => toggleStep("setup")}>
                <div className="rounded-lg border bg-card p-4 space-y-4">
                  {bundleInputs.map((input) => (
                    <div key={input.key} className="space-y-1">
                      <Label className="text-xs flex items-center gap-1.5">
                        {input.label}
                        {input.required && (
                          <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">required</Badge>
                        )}
                      </Label>
                      {isTimezoneInput(input) ? (
                        <TimezoneSelect
                          value={inputValues[input.key] || ""}
                          onChange={(tz) => setInputValues((prev) => ({ ...prev, [input.key]: tz }))}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <Input
                          value={inputValues[input.key] || ""}
                          onChange={(e) => setInputValues((prev) => ({ ...prev, [input.key]: e.target.value }))}
                          placeholder={input.placeholder || ""}
                          className="h-8 text-sm"
                        />
                      )}
                      {input.description && (
                        <p className="text-[11px] text-muted-foreground">{input.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </WizardStep>
            )}

            {/* Connections — actionable right here: a jump to the /integrations
                directory for service integrations, inline paste-and-save for
                secrets. Everything is org-level, so connecting before the agent
                exists is fine. */}
            {(preview.integrations.length > 0 || preview.secrets.length > 0 || preview.channels.length > 0) && (
              <WizardStep id="connections" title="Connections" state={missingRequired.length ? "attention" : "done"} summary={missingRequired.length ? `connect ${missingRequired.map(svcLabel).join(", ")}` : "everything required is connected"} open={!!openSteps["connections"]} onToggle={() => toggleStep("connections")}>
                <p className="text-xs text-muted-foreground mb-3 max-w-lg">
                  Connect now or after deploy — your call. Anything left unconnected shows up as a reminder on the agent's page.
                </p>
                <div className="rounded-lg border bg-card divide-y">
                  {/* Always-true baseline so nobody wonders how they'll talk
                      to the thing they're about to hire. */}
                  <div className="flex items-center gap-2 px-4 py-2.5 text-xs">
                    <Radio className="size-3.5 text-muted-foreground" />
                    <span className="font-medium">Chat in the app</span>
                    <span className="text-[10px] text-muted-foreground truncate">— always on; talk to the agent from its page</span>
                    <Badge className="text-[10px] gap-1 ml-auto shrink-0 bg-emerald-600 hover:bg-emerald-600"><Check className="size-3" /> Included</Badge>
                  </div>
                  {preview.channels.map((c) => (
                    <div key={c.type} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                      <Radio className="size-3.5 text-muted-foreground" />
                      <span className="font-medium capitalize">{c.type}</span>
                      {c.type === "email" ? (
                        orgDomain ? (
                          <span className="text-[10px] text-muted-foreground truncate">
                            — gets its own inbox: <span className="font-mono text-foreground">{(slugify(agentName) || agentSlug || "agent")}@{orgDomain}</span>. Email it, CC it, forward it work.
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                            — your workspace has no email domain yet, so this agent can't get an inbox
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] text-muted-foreground truncate">
                          — {c.why || `finish pairing on the agent's Channels tab after deploy`}
                        </span>
                      )}
                      <span className={`text-[10px] ml-auto shrink-0 ${c.type === "email" && !orgDomain ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {c.type === "email" && orgDomain ? "connects at deploy" : c.type === "email" ? "needs setup" : "pair after deploy"}
                      </span>
                    </div>
                  ))}
                  {/* Domain missing → fix it right here: claim an instant
                      <name>.{zone} domain (platform zone, auto-DNS, no wait),
                      or link out for a custom domain. */}
                  {!orgDomain && preview.channels.some((c) => c.type === "email") && (
                    <div className="px-4 py-3 space-y-2 bg-amber-500/5">
                      {managed_email_zone ? (
                        <>
                          <p className="text-[11px] text-muted-foreground">
                            Get one instantly — free <span className="font-mono">@{managed_email_zone}</span> address, no DNS setup:
                          </p>
                          <div className="flex items-center gap-2">
                            <Input
                              value={claimLabel}
                              onChange={(e) => setClaimLabel(e.target.value)}
                              placeholder="yourcompany"
                              className="h-7 w-40 text-xs"
                            />
                            <span className="text-xs text-muted-foreground font-mono">.{managed_email_zone}</span>
                            <Button type="button" size="sm" className="h-7 text-[11px]" disabled={claimBusy || !claimLabel.trim()} onClick={claimSubdomain}>
                              {claimBusy ? "Claiming…" : "Claim"}
                            </Button>
                            <a href="/settings" className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1">use my own domain</a>
                          </div>
                          {claimError && <p className="text-[11px] text-destructive">{claimError}</p>}
                        </>
                      ) : (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Set a workspace email domain in <a href="/settings" className="underline">Settings</a> so this agent can get an inbox.
                        </p>
                      )}
                    </div>
                  )}
                  {preview.channels.length === 0 && (
                    <div className="px-4 py-2.5 text-[10px] text-muted-foreground">
                      Want it on email, Telegram, or WhatsApp too? Add channels on the agent's Channels tab after deploy.
                    </div>
                  )}
                  {preview.integrations
                    .filter((i): i is { service: string; kind: "service" | "mcp"; required?: boolean; why: string | null } => i.kind !== "choice")
                    .map((i) => {
                      const isConnected = connected.has(normSvc(i.service))
                      return (
                        <div key={`${i.kind}-${i.service}`} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                          {svcEntry(i.service)?.logo ? (
                            <img src={svcEntry(i.service)!.logo!} alt="" className="size-3.5 shrink-0" />
                          ) : (
                            <Plug className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium">{svcLabel(i.service)}</span>
                          {i.required && !isConnected && (
                            <Badge variant="secondary" className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">required before deploy</Badge>
                          )}
                          {i.why && <span className="text-[10px] text-muted-foreground truncate">— {i.why}</span>}
                          <span className="ml-auto shrink-0">
                            {i.kind === "mcp" ? (
                              <span className="text-[10px] text-muted-foreground">not supported yet</span>
                            ) : isConnected ? (
                              <Badge className="text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-600"><Check className="size-3" /> Connected</Badge>
                            ) : (
                              <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => connectIntegration(i.service)}>
                                Connect
                              </Button>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  {/* any_of groups: the bundle needs ANY ONE of these (e.g. a
                      calendar). Pick which to use — connected options first-
                      class; if none is connected yet, nudge to connect one. */}
                  {choiceGroups.map((group, gi) => {
                    const chosen = integrationChoices[gi]
                    const connectedCount = group.options.filter((o) => connected.has(normSvc(o))).length
                    return (
                      <div key={`choice-${gi}`} className="px-4 py-3 text-xs space-y-2">
                        <div className="flex items-center gap-2">
                          <Plug className="size-3.5 text-muted-foreground" />
                          <span className="font-medium">{group.multi ? "Publishing networks" : "Pick one"}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.multi
                              ? group.required && connectedCount === 0
                                ? "connect at least one — the agent posts to every one you connect"
                                : `${connectedCount} connected — posts to every one you connect`
                              : `one of ${group.options.length}${group.required ? ", needed for the agent to work" : ""}`}
                          </span>
                        </div>
                        {/* One pill per option — the pill IS the connect action.
                            No checkbox + button + banner triple-signal. */}
                        <div className="flex flex-wrap gap-1.5">
                          {group.options.map((service) => {
                            const isConnected = connected.has(normSvc(service))
                            const isChosen = !group.multi && chosen === service
                            return (
                              <button
                                key={service}
                                type="button"
                                onClick={() => {
                                  if (!group.multi) chooseIntegration(gi, service)
                                  if (!isConnected) connectIntegration(service)
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors ${
                                  isConnected
                                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : isChosen
                                      ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                                }`}
                              >
                                {isConnected ? <Check className="size-3" /> : <Plus className="size-3" />}
                                <span className="font-medium">{svcLabel(service)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {preview.secrets.map((s) => {
                    const saved = savedSecrets.has(s)
                    const adv = secretAdvanced.has(s)
                    const meta = secretMeta[s] || { base_url: "", usage_md: "" }
                    return (
                      <div key={s} className="px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
                          <span className="font-mono text-[11px] shrink-0">{s}</span>
                          {saved ? (
                            <Badge className="text-[10px] gap-1 ml-auto bg-emerald-600 hover:bg-emerald-600"><Check className="size-3" /> Saved</Badge>
                          ) : (
                            <span className="flex items-center gap-1.5 ml-auto flex-1 max-w-72">
                              <Input
                                type="password"
                                value={secretValues[s] || ""}
                                onChange={(e) => setSecretValues((prev) => ({ ...prev, [s]: e.target.value }))}
                                placeholder="paste value…"
                                className="h-7 text-[11px] font-mono"
                              />
                              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] shrink-0" disabled={secretBusy === s || !(secretValues[s] || "").trim()} onClick={() => saveSecret(s)}>
                                {secretBusy === s ? "Saving…" : "Save"}
                              </Button>
                            </span>
                          )}
                        </div>
                        {!saved && (
                          <>
                            <button
                              type="button"
                              className="mt-1.5 ml-5 text-[10px] text-muted-foreground hover:text-foreground"
                              onClick={() => setSecretAdvanced((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n })}
                            >
                              {adv ? "− Hide base URL & docs" : "+ Base URL & docs (for self-hosted / custom APIs)"}
                            </button>
                            {adv && (
                              <div className="mt-2 ml-5 space-y-2 max-w-md">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Base URL — where the agent calls this API</Label>
                                  <Input
                                    value={meta.base_url}
                                    onChange={(e) => setSecretMeta((prev) => ({ ...prev, [s]: { ...meta, base_url: e.target.value } }))}
                                    placeholder="https://listmonk.yourbrand.com"
                                    className="h-7 text-[11px] font-mono"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Usage notes (optional) — docs the agent reads from secrets.get</Label>
                                  <textarea
                                    value={meta.usage_md}
                                    onChange={(e) => setSecretMeta((prev) => ({ ...prev, [s]: { ...meta, usage_md: e.target.value } }))}
                                    placeholder="Auth: Authorization: token api_user:token · key endpoints, gotchas…"
                                    className="w-full min-h-[52px] rounded-md border bg-background p-2 text-[11px]"
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
                {connectError && (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{connectError}</div>
                )}
              </WizardStep>
            )}

            {/* Deploy — the rail's terminal node */}
            <section id="deploy-node" className="relative pl-9 space-y-3 pb-8 scroll-mt-24">
              <div
                className={`absolute left-0 top-0 grid size-6 place-items-center rounded-full border transition-colors duration-500 ${
                  authenticated && missingRequired.length === 0 && missingInputs.length === 0
                    ? "border-primary bg-primary text-primary-foreground step-ready-glow"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                <Rocket className="size-3" />
              </div>
              {!updating && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={saveAsTemplate} onCheckedChange={(v) => setSaveAsTemplate(!!v)} />
                  Also save to the template library (versioned, re-installable)
                </label>
              )}
              {deployError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{deployError}</div>
              )}
              <div className="flex flex-col items-end gap-2">
                {/* Compact readiness recap: one chip per unmet gate, each a
                    jump-link to its step. The rail carries the detail; this
                    row just answers "why is the button disabled". */}
                {authenticated && (missingInputs.length > 0 || missingRequired.length > 0) && (
                  <div className="flex items-center justify-end gap-1.5 flex-wrap text-[11px]">
                    {missingInputs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => document.querySelector("#step-setup")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                      >
                        <AlertTriangle className="size-3" />
                        {missingInputs.length} setup field{missingInputs.length === 1 ? "" : "s"} to fill
                      </button>
                    )}
                    {missingRequired.length > 0 && (
                      <button
                        type="button"
                        onClick={() => document.querySelector("#step-connections")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                      >
                        <Plug className="size-3" />
                        {missingRequired.map((m) => (m === "a network" ? "connect one network" : `connect ${svcLabel(m)}`)).join(" · ")}
                      </button>
                    )}
                  </div>
                )}
                <div className="flex flex-col items-end gap-1.5">
                  <Button
                    type="button"
                    onClick={deploy}
                    disabled={deploying || (authenticated && (missingRequired.length > 0 || missingInputs.length > 0))}
                  >
                    <Rocket className="size-4 mr-1.5" />
                    {!authenticated
                      ? `Sign in to deploy ${preview.name}`
                      : deploying
                        ? (updating ? "Redeploying…" : "Deploying…")
                        : updating
                          ? `Redeploy to ${targetAgent?.name || "agent"}`
                          : `Deploy ${agentName.trim() || preview.name}`}
                  </Button>
                  {/* Quiet escape hatch — connections are the only skippable
                      gate (the agent deploys fine and nags to connect later);
                      setup inputs are not (substitution needs them). */}
                  {authenticated && missingRequired.length > 0 && missingInputs.length === 0 && !deploying && (
                    <button
                      type="button"
                      onClick={() => deploy()}
                      className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      or deploy without connecting — connect later from the agent's page
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  )

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 via-background to-background">
        {/* Same floating navbar + logo as the marketing site for brand
            continuity on shared deploy links. */}
        <LandingNav />

        {preview ? (
          // Two-column: template showcase (left) + sticky auth card (right).
          // No modal, no blur — the template is always fully readable while
          // the visitor signs in or creates an account inline.
          <main className="mx-auto grid max-w-6xl gap-8 px-5 pb-12 pt-28 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0">
              <TemplateShowcase preview={preview} />
            </div>
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-border bg-card shadow-sm">
                <AuthPanel bundleName={preview.name} />
              </div>
              <p className="mt-3 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
                Free to start · You'll land right back here after signing in, ready to deploy.
              </p>
            </aside>
          </main>
        ) : (
          // No bundle loaded (bare /deploy-agent) — center the auth card with
          // a short explainer; the source-paste form lives behind auth.
          <main className="mx-auto flex max-w-md flex-col items-center px-5 pb-16 pt-28">
            <div className="mb-6 text-center">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-indigo)]">
                <Rocket className="size-3.5" /> Deploy an agent
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">Sign in to deploy a bundle</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Open a shared deploy link, or sign in to paste a GitHub bundle URL.
              </p>
              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                  <span>{error}</span>
                </div>
              )}
            </div>
            <div className="w-full rounded-2xl border border-border bg-card shadow-sm">
              <AuthPanel bundleName={null} />
            </div>
          </main>
        )}
      </div>
    )
  }

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Deploy agent" }]}>
      {pageBody}
          {connectingApp && (
        <ConnectModal
          app={connectingApp}
          scope="org"
          connectBaseUrl={nango_connect_base_url}
          onClose={() => setConnectingApp(null)}
          onConnected={() => {
            setConnected((prev) => {
              const next = new Set(prev)
              next.add(normSvc(connectingApp.slug))
              return next
            })
            setConnectingApp(null)
          }}
        />
      )}
    </AppLayout>
  )
}

// Inline auth card for the anonymous deploy page — sign in OR create an
// account without leaving the template (it's right beside this card).
// Devise's stored location (set in AgentBundlesController#new) brings the
// user back to this exact URL after either flow, and the deploy wizard is
// whitelisted from the onboarding gate so a fresh signup deploys at once.

// One vertical step on the deploy page: status bubble + connector line,
// collapsible body with a one-line summary when closed. Deliberately NOT a
// paged wizard — everything stays on one page; steps are structure +
// completion state, and the required ones ship open.
function WizardStep({ id, title, state = "none", summary, open, onToggle, children }: {
  id: string
  title: string
  state?: "done" | "attention" | "none"
  summary?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section id={`step-${id}`} className="relative pl-9 scroll-mt-24">
      {/* Connector fills green once the step is satisfied — progress you can
          see flow down the rail. */}
      <div
        className={`absolute left-[11px] top-7 -bottom-6 w-px transition-colors duration-700 ${
          state === "done" ? "bg-emerald-500/50" : "bg-border"
        }`}
        aria-hidden
      />
      <div
        className={`absolute left-0 top-0 grid size-6 place-items-center rounded-full border transition-colors duration-500 ${
          state === "done"
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : state === "attention"
              ? "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-400 step-attention-pulse"
              : "border-border bg-muted text-muted-foreground"
        }`}
      >
        {state === "done" ? (
          <Check className="size-3.5 step-check-pop" />
        ) : state === "attention" ? (
          <AlertTriangle className="size-3" />
        ) : (
          <Circle className="size-1.5 fill-current" />
        )}
      </div>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        <Overline>{title}</Overline>
        {!open && summary && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span>}
        <ChevronDown className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-3 step-body-enter">{children}</div>}
    </section>
  )
}

function AuthPanel({ bundleName }: { bundleName: string | null }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin")

  const signin = useForm({ user: { email: "", password: "" } })
  const signup = useForm({ user: { name: "", email: "", password: "", password_confirmation: "", organization_name: "" } })

  function submitSignin(e: React.FormEvent) {
    e.preventDefault()
    signin.post(userSessionPath())
  }
  function submitSignup(e: React.FormEvent) {
    e.preventDefault()
    signup.post(userRegistrationPath())
  }

  const processing = mode === "signin" ? signin.processing : signup.processing

  return (
    <div>
      <div className="space-y-1.5 px-5 pt-5 pb-4">
        <h2 className="text-base font-semibold tracking-tight">
          {mode === "signin"
            ? (bundleName ? `Deploy ${bundleName}` : "Sign in to deploy")
            : "Create your account"}
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {mode === "signin" ? "Sign in to deploy this agent to your workspace." : "Set up your workspace — about a minute."}
        </p>
      </div>

      <div className="space-y-3.5 px-5 pb-5">
        <GoogleSignInButton label={mode === "signin" ? "Continue with Google" : "Sign up with Google"} />

        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {mode === "signin" ? (
          <form onSubmit={submitSignin} className="space-y-3">
            <AuthField label="Email" id="ov-si-email" type="email" placeholder="you@company.com"
              value={signin.data.user.email}
              onChange={(v) => signin.setData("user", { ...signin.data.user, email: v })}
              error={signin.errors["user.email"] as string | undefined} />
            <AuthField label="Password" id="ov-si-password" type="password" placeholder="••••••••"
              value={signin.data.user.password}
              onChange={(v) => signin.setData("user", { ...signin.data.user, password: v })}
              error={signin.errors["user.password"] as string | undefined} />
            <Button type="submit" className="h-9 w-full" disabled={processing}>
              {processing ? "Signing in…" : "Sign in & continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitSignup} className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <AuthField label="Your name" id="ov-su-name" placeholder="Ada Lovelace"
                value={signup.data.user.name}
                onChange={(v) => signup.setData("user", { ...signup.data.user, name: v })} />
              <AuthField label="Workspace" id="ov-su-org" placeholder="Acme"
                value={signup.data.user.organization_name}
                onChange={(v) => signup.setData("user", { ...signup.data.user, organization_name: v })} />
            </div>
            <AuthField label="Work email" id="ov-su-email" type="email" placeholder="you@company.com"
              value={signup.data.user.email}
              onChange={(v) => signup.setData("user", { ...signup.data.user, email: v })}
              error={signup.errors["user.email"] as string | undefined} />
            <div className="grid grid-cols-2 gap-2.5">
              <AuthField label="Password" id="ov-su-pw" type="password" placeholder="8+ chars"
                value={signup.data.user.password}
                onChange={(v) => signup.setData("user", { ...signup.data.user, password: v })}
                error={signup.errors["user.password"] as string | undefined} />
              <AuthField label="Confirm" id="ov-su-pwc" type="password" placeholder="repeat"
                value={signup.data.user.password_confirmation}
                onChange={(v) => signup.setData("user", { ...signup.data.user, password_confirmation: v })} />
            </div>
            <Button type="submit" className="h-9 w-full" disabled={processing}>
              {processing ? "Creating…" : "Create account & continue"}
            </Button>
          </form>
        )}
      </div>

      <div className="rounded-b-2xl border-t border-border bg-muted/30 px-5 py-3 text-center text-xs text-muted-foreground">
        {mode === "signin" ? (
          <>New to sentrel?{" "}
            <button type="button" className="font-medium text-foreground hover:underline" onClick={() => setMode("signup")}>Create an account</button>
          </>
        ) : (
          <>Already have one?{" "}
            <button type="button" className="font-medium text-foreground hover:underline" onClick={() => setMode("signin")}>Sign in</button>
          </>
        )}
      </div>
    </div>
  )
}

// Read-only showcase of a bundle for the anonymous deploy page — turns the
// raw preview into a scannable "what you're about to deploy" panel.
function TemplateShowcase({ preview }: { preview: Preview }) {
  const integrationLabels = (preview.integrations || []).map((i) =>
    i.kind === "choice"
      ? `${i.options[0]}${i.options.length > 1 ? ` +${i.options.length - 1}` : ""}`
      : i.service,
  )
  const facts: Array<{ icon: typeof Wrench; label: string }> = [
    { icon: Sparkle, label: preview.model?.id || preview.model?.model_id || "anthropic" },
    ...(preview.skills?.length ? [{ icon: Wrench, label: `${preview.skills.length} skill${preview.skills.length > 1 ? "s" : ""}` }] : []),
    ...(preview.schedules?.length ? [{ icon: Clock, label: `${preview.schedules.length} schedule${preview.schedules.length > 1 ? "s" : ""}` }] : []),
    ...(preview.webhooks?.length ? [{ icon: Plug, label: `${preview.webhooks.length} webhook${preview.webhooks.length > 1 ? "s" : ""}` }] : []),
  ]

  return (
    <div className="space-y-7">
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-indigo)]">
          <Rocket className="size-3.5" /> Agent template
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{preview.name}</h1>
        {preview.role && <p className="mt-1 text-base text-muted-foreground">{preview.role}</p>}
        {preview.description && (
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{preview.description}</p>
        )}
        {facts.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {facts.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
                <f.icon className="size-3 text-muted-foreground" /> {f.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {preview.goal?.mission && (
        <ShowcaseSection icon={Target} title="What it does">
          <p className="text-sm leading-relaxed text-muted-foreground">{preview.goal.mission}</p>
        </ShowcaseSection>
      )}

      {integrationLabels.length > 0 && (
        <ShowcaseSection icon={Plug} title="Connects to">
          <div className="flex flex-wrap gap-2">
            {integrationLabels.map((label, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium capitalize">
                {label}
              </span>
            ))}
          </div>
        </ShowcaseSection>
      )}

      {preview.skills?.length > 0 && (
        <ShowcaseSection icon={Wrench} title="Skills">
          <ul className="space-y-1.5">
            {preview.skills.map((s) => (
              <li key={s.slug} className="flex items-center gap-2 text-sm">
                <Check className="size-3.5 shrink-0 text-emerald-500" />
                <span className="font-medium capitalize">{s.slug.replace(/-/g, " ")}</span>
              </li>
            ))}
          </ul>
        </ShowcaseSection>
      )}

      {(preview.schedules?.length > 0 || (preview.webhooks?.length || 0) > 0) && (
        <ShowcaseSection icon={Clock} title="Runs automatically">
          <ul className="space-y-2">
            {preview.schedules.map((s) => (
              <li key={s.name} className="flex items-start gap-2 text-sm">
                <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span><span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· {describeCron(s.cron) || s.cron}</span></span>
              </li>
            ))}
            {(preview.webhooks || []).map((w) => (
              <li key={w.name} className="flex items-start gap-2 text-sm">
                <Plug className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span><span className="font-medium">{w.name}</span> <span className="text-muted-foreground">· on {w.source} webhook</span></span>
              </li>
            ))}
          </ul>
        </ShowcaseSection>
      )}
    </div>
  )
}

function ShowcaseSection({ icon: Icon, title, children }: { icon: typeof Wrench; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" /> {title}
      </h2>
      {children}
    </section>
  )
}

function AuthField({ label, id, type = "text", placeholder, value, onChange, error, autoFocus }: {
  label: string; id: string; type?: string; placeholder?: string; value: string;
  onChange: (v: string) => void; error?: string; autoFocus?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        required
        className={`h-9 ${error ? "border-destructive" : ""}`}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
