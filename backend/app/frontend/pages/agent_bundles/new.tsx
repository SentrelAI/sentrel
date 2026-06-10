import { Head, router } from "@inertiajs/react"
import { useState } from "react"
import {
  AlertTriangle, BookOpen, FolderGit2, KeyRound, Plug, Plus, Radio, Rocket, Search, Target, Trash2, Wrench,
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
import { MarkdownEditor } from "@/components/markdown-editor"
import { slugify } from "@/lib/random-names"
import { MODELS_BY_PROVIDER } from "@/lib/model-catalog"

// The shareable "Deploy to double.md" wizard.
//   /deploy-agent?source=https://github.com/owner/repo[/tree/ref/subdir]
// Server fetches + validates the bundle; this page renders it as a fully
// EDITABLE form — rename, change model, edit the goal, rewrite any persona
// block (with {{variable}} chips, same editor as the agent Identity tab) —
// then POSTs the merged result to /agent_bundles.

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
  integrations: Array<{ service: string; kind: "composio" | "mcp"; why: string | null }>
  secrets: string[]
  permissions: Record<string, string>
}

interface Props {
  source: string
  preview: Preview | null
  error: string | null
}

interface KpiRow {
  key: string
  value: string
}

export default function DeployAgent({ source, preview, error }: Props) {
  const [url, setUrl] = useState(source)
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
  const [saveAsTemplate, setSaveAsTemplate] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  function loadPreview() {
    router.get("/deploy-agent", { source: url.trim() }, { preserveState: false })
  }

  function handleNameChange(name: string) {
    setAgentName(name)
    setAgentSlug(slugify(name))
  }

  function deploy() {
    setDeployError(null)
    setDeploying(true)
    router.post("/agent_bundles", {
      github_url: source,
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
      save_as_template: saveAsTemplate ? "1" : "0",
    }, {
      onError: (errors) => setDeployError(Object.values(errors).join(", ") || "Deploy failed"),
      onFinish: () => setDeploying(false),
    })
  }

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Deploy agent" }]}>
      <Head title="Deploy agent bundle" />
      <PageHeader
        eyebrow="Deploy"
        title={preview ? `Deploy ${agentName.trim() || preview.name}` : "Deploy an agent bundle"}
        description={preview
          ? "Everything below comes from the bundle and is editable — rename, adjust the goal, change the model, rewrite the persona. Deploy when it looks right."
          : "Paste a GitHub repo containing an agent-bundle/v1 (agent.yaml at its root) to preview and deploy it."}
      />

      <div className="max-w-2xl space-y-6">
        {/* Source */}
        <section>
          <Overline className="mb-3">Source</Overline>
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
              Public repos only. Share this page as <code className="font-mono">/deploy-agent?source=&lt;repo-url&gt;</code> — anyone in a workspace can one-click install your agent.
            </p>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <>
            {/* Agent details — name/slug/role/model, all editable, at the top */}
            <section>
              <Overline className="mb-3">Agent details</Overline>
              <div className="rounded-lg border bg-card p-4 space-y-4">
                {preview.description && <p className="text-xs text-muted-foreground leading-relaxed">{preview.description}</p>}
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
            </section>

            {/* Goal — editable */}
            <section>
              <Overline className="mb-3">Goal</Overline>
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
            </section>

            {/* Persona — same editor as the agent Identity tab, variable chips included */}
            <section>
              <Overline className="mb-3">Persona</Overline>
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
            </section>

            {/* Skills + knowledge (from the bundle — read-only) */}
            <section>
              <Overline className="mb-3">Skills & knowledge</Overline>
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
            </section>

            {/* What you'll connect after deploy */}
            {(preview.integrations.length > 0 || preview.secrets.length > 0 || preview.channels.length > 0) && (
              <section>
                <Overline className="mb-3">After deploy, you'll connect</Overline>
                <div className="rounded-lg border bg-card divide-y">
                  {preview.channels.map((c) => (
                    <div key={c.type} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                      <Radio className="size-3.5 text-muted-foreground" />
                      <span className="font-medium capitalize">{c.type} channel</span>
                      {c.why && <span className="text-[10px] text-muted-foreground truncate">— {c.why}</span>}
                    </div>
                  ))}
                  {preview.integrations.map((i) => (
                    <div key={`${i.kind}-${i.service}`} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                      <Plug className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{i.service}</span>
                      <Badge variant="outline" className="text-[9px]">{i.kind}</Badge>
                      {i.why && <span className="text-[10px] text-muted-foreground truncate">— {i.why}</span>}
                    </div>
                  ))}
                  {preview.secrets.map((s) => (
                    <div key={s} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                      <KeyRound className="size-3.5 text-muted-foreground" />
                      <span className="font-mono text-[11px]">{s}</span>
                      <span className="text-[10px] text-muted-foreground">— add at /settings/credentials</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Deploy */}
            <section className="space-y-3 pb-8">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={saveAsTemplate} onCheckedChange={(v) => setSaveAsTemplate(!!v)} />
                Also save to the template library (versioned, re-installable)
              </label>
              {deployError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{deployError}</div>
              )}
              <div className="flex justify-end">
                <Button type="button" onClick={deploy} disabled={deploying}>
                  <Rocket className="size-4 mr-1.5" />
                  {deploying ? "Deploying…" : `Deploy ${agentName.trim() || preview.name}`}
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}
