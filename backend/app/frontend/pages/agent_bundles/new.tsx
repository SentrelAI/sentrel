import { Head, router } from "@inertiajs/react"
import { useState } from "react"
import {
  AlertTriangle, BookOpen, FolderGit2, KeyRound, Plug, Radio, Rocket, Search, Target, Wrench,
} from "lucide-react"

import { Overline } from "@/components/brand"
import { PageHeader } from "@/components/page-header"
import AppLayout from "@/layouts/app-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"

// The shareable "Deploy to double.md" wizard.
//   /deploy-agent?source=https://github.com/owner/repo[/tree/ref/subdir]
// Server fetches + validates the bundle and ships a preview; this page
// renders exactly what will be installed, then POSTs /agent_bundles.

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

export default function DeployAgent({ source, preview, error }: Props) {
  const [url, setUrl] = useState(source)
  const [saveAsTemplate, setSaveAsTemplate] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  function loadPreview() {
    router.get("/deploy-agent", { source: url.trim() }, { preserveState: false })
  }

  function deploy() {
    setDeployError(null)
    setDeploying(true)
    router.post("/agent_bundles", { github_url: source, save_as_template: saveAsTemplate ? "1" : "0" }, {
      onError: (errors) => setDeployError(Object.values(errors).join(", ") || "Deploy failed"),
      onFinish: () => setDeploying(false),
    })
  }

  return (
    <AppLayout crumbs={[{ label: "Workspace", href: "/" }, { label: "Deploy agent" }]}>
      <Head title="Deploy agent bundle" />
      <PageHeader
        eyebrow="Deploy"
        title={preview ? `Deploy ${preview.name}` : "Deploy an agent bundle"}
        description={preview
          ? "Review what this bundle installs, then deploy it as a live agent in your workspace."
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
            {/* What you're installing */}
            <section>
              <Overline className="mb-3">Agent</Overline>
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold">{preview.name}</div>
                  <div className="text-xs text-muted-foreground">{preview.role}</div>
                </div>
                {preview.description && <p className="text-xs text-muted-foreground leading-relaxed">{preview.description}</p>}
                {preview.goal?.mission && (
                  <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-medium"><Target className="size-3.5" /> Goal</div>
                    <p className="text-muted-foreground">{preview.goal.mission}</p>
                    {(preview.goal.kpis?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {preview.goal.kpis!.map((kpi, i) => {
                          const [k, v] = Object.entries(kpi)[0] || ["", ""]
                          return <Badge key={i} variant="outline" className="text-[10px]">{k.replace(/_/g, " ")}: {v}</Badge>
                        })}
                      </div>
                    )}
                  </div>
                )}
                {(preview.model.id || preview.model.model_id) && (
                  <p className="text-[11px] text-muted-foreground">
                    Model: <span className="font-mono">{preview.model.provider || "anthropic"}/{preview.model.id || preview.model.model_id}</span>
                  </p>
                )}
              </div>
            </section>

            {/* Persona */}
            <section>
              <Overline className="mb-3">Persona</Overline>
              <div className="rounded-lg border bg-card p-4 space-y-2">
                {([
                  ["Identity", preview.persona.identity_md],
                  ["Personality", preview.persona.personality_md],
                  ["Instructions", preview.persona.instructions_md],
                ] as const).map(([label, md]) =>
                  md ? (
                    <details key={label} className="rounded border bg-background">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">{label}</summary>
                      <pre className="whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed">{md}</pre>
                    </details>
                  ) : null,
                )}
              </div>
            </section>

            {/* Skills + knowledge */}
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
                  {deploying ? "Deploying…" : `Deploy ${preview.name}`}
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}
