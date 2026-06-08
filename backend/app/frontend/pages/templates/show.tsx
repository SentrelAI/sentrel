import { Head, Link, router } from "@inertiajs/react"
import {
  ArrowLeft,
  Sparkles,
  Users,
  Trash2,
  Download,
  FileCode,
  Eye,
  ChevronRight,
  ChevronDown,
  Wrench,
  Plug,
  Shield,
  Zap,
  ScrollText,
} from "lucide-react"
import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import AppLayout from "@/layouts/app-layout"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { JsonViewer } from "@/components/agent-templates/json-viewer"

interface Template {
  slug: string
  name: string
  role: string
  description: string | null
  category: string | null
  capabilities: Record<string, { enabled?: boolean; provider?: string }>
  suggested_skill_slugs: string[]
  suggested_provider: string | null
  suggested_model: string | null
  identity_md: string | null
  personality_md: string | null
  instructions_md: string | null
  install_count: number
  published: boolean
  system_template: boolean
  author_name: string
  owned_by_me: boolean
  license: string | null
}

interface VersionSummary {
  version_number: number
  spec_version: string
  license: string | null
  changelog: string | null
  created_at: string
  created_by: string | null
}

interface SkillBundle {
  slug: string
  name?: string
  description?: string
  category?: string
  icon?: string
  requires_connections?: string[]
  required_capabilities?: string[]
  files?: Array<{ path: string; content: string; file_type?: string }>
}

interface ApprovalRule {
  label?: string | null
  payload_type?: string | null
  predicate?: Record<string, unknown>
  auto_decision?: "approve" | "reject"
  enabled?: boolean
  scope?: string
}

interface Definition {
  spec_version: string
  name: string
  role: string
  description?: string
  category?: string
  license?: string
  metadata?: { exported_at?: string; exported_by?: { name?: string; email?: string }; source_agent_public_id?: string }
  persona?: {
    identity_md?: string
    personality_md?: string
    instructions_md?: string
    email_signature_md?: string
  }
  model?: { provider?: string; model_id?: string; temperature?: number; max_tokens?: number; thinking_level?: string }
  capabilities?: Record<string, { enabled?: boolean; provider?: string }>
  permissions?: Record<string, string>
  spend_caps?: { daily_usd?: number; monthly_usd?: number; notify_threshold_pct?: number }
  approval_rules?: ApprovalRule[]
  skills?: SkillBundle[]
  integrations_required?: Array<{ service: string; why?: string }>
  credentials_required?: Array<{ kind?: string; provider?: string; name_hint?: string }>
  channels_required?: Array<{ type: string; why?: string }>
}

interface Props {
  template: Template
  definition: Definition
  current_version: VersionSummary | null
  versions: VersionSummary[]
}

export default function TemplateShow({ template, definition, current_version, versions }: Props) {
  const [tab, setTab] = useState<"rendered" | "json">("rendered")
  // Active version comes from current_version when fresh-loaded; user can
  // switch via the dropdown which triggers an Inertia visit with ?version=N.
  const activeVersion = current_version?.version_number

  function switchVersion(n: number) {
    router.get(`/agent_templates/${template.slug}`, { version: n }, {
      preserveScroll: true,
      preserveState: false,
    })
  }

  function downloadJson() {
    if (typeof window === "undefined") return
    window.location.href = `/agent_templates/${template.slug}/export`
  }

  return (
    <AppLayout
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Templates", href: "/agent_templates" },
        { label: template.name },
      ]}
    >
      <Head title={`${template.name} · template`} />

      <PageHeader
        eyebrow="Template"
        title={template.name}
        description={definition.description || template.description || `An agent set up to act as a ${template.role}.`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={downloadJson}>
              <Download className="size-4 mr-1.5" /> agent.json
            </Button>
            <Button asChild size="lg">
              <Link href={`/agents/new?template=${template.slug}${activeVersion ? `&version=${activeVersion}` : ""}`}>
                <Sparkles className="size-4 mr-1.5" />
                Hire this agent
              </Link>
            </Button>
          </div>
        }
      />

      <div className="max-w-4xl space-y-4">
        {/* Header card — meta + version picker + license */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {template.system_template ? (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" /> System
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Users className="size-3" /> Community
                </Badge>
              )}
              <Badge variant="outline">Role · {template.role}</Badge>
              {template.category && <Badge variant="outline">{template.category}</Badge>}
              {template.license && (
                <Badge variant="outline" className="font-mono">{template.license}</Badge>
              )}
              {template.install_count > 0 && (
                <span className="text-muted-foreground">{template.install_count} installs</span>
              )}
              <span className="ml-auto text-muted-foreground">by {template.author_name}</span>
            </div>

            {versions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">Version</span>
                <Select
                  value={activeVersion ? String(activeVersion) : ""}
                  onValueChange={(v) => switchVersion(Number(v))}
                >
                  <SelectTrigger className="h-7 w-44 text-xs">
                    <SelectValue placeholder="(current)" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.version_number} value={String(v.version_number)}>
                        v{v.version_number}
                        {v.changelog ? ` · ${v.changelog.slice(0, 30)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {current_version?.created_at && (
                  <span className="text-muted-foreground">
                    {new Date(current_version.created_at).toLocaleDateString()}
                  </span>
                )}
                {current_version?.created_by && (
                  <span className="text-muted-foreground">· {current_version.created_by}</span>
                )}
                {current_version?.spec_version && (
                  <Badge variant="outline" className="font-mono text-[10px]">spec {current_version.spec_version}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabs — Rendered (default) vs raw agent.json */}
        <div className="flex items-center gap-0 border-b border-border">
          {([
            { key: "rendered", label: "Rendered", icon: Eye },
            { key: "json",     label: "agent.json", icon: FileCode },
          ] as const).map((t) => {
            const Icon = t.icon
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {t.label}
                {active && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}
              </button>
            )
          })}
        </div>

        {tab === "rendered" ? (
          <RenderedView template={template} definition={definition} />
        ) : (
          <JsonViewer
            value={definition}
            filename={`${template.slug}.agent.json`}
            label={`agent.json · spec ${definition.spec_version || "1.0"}`}
          />
        )}

        {/* Owner controls */}
        {template.owned_by_me && !template.system_template && (
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                router.patch(`/agent_templates/${template.slug}`, {
                  template: { published: !template.published },
                })
              }}
            >
              {template.published ? "Unpublish" : "Publish to org"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!confirm(`Delete template "${template.name}"?`)) return
                router.delete(`/agent_templates/${template.slug}`)
              }}
            >
              <Trash2 className="size-4 mr-1.5 text-destructive" />
              Delete
            </Button>
          </div>
        )}

        <div className="pt-2">
          <Link href="/agent_templates" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="size-3" /> Back to templates
          </Link>
        </div>
      </div>
    </AppLayout>
  )
}

// ── Rendered tab ───────────────────────────────────────────────────

function RenderedView({ template, definition }: { template: Template; definition: Definition }) {
  const enabledCaps = useMemo(
    () => Object.entries(definition.capabilities || {})
      .filter(([_k, v]) => v?.enabled !== false)
      .map(([k, v]) => ({ key: k, provider: v?.provider })),
    [definition.capabilities],
  )

  const skills = definition.skills || []
  const integrations = definition.integrations_required || []
  const credentials = definition.credentials_required || []
  const channels = definition.channels_required || []
  const rules = definition.approval_rules || []

  return (
    <div className="space-y-4">
      {/* Capabilities grid */}
      {enabledCaps.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <SectionLabel icon={Zap} label="Capabilities" count={enabledCaps.length} />
            <div className="flex flex-wrap gap-1.5">
              {enabledCaps.map(({ key, provider }) => (
                <Badge key={key} variant="outline" className="text-xs font-mono">
                  {key}
                  {provider && provider !== "auto" && (
                    <span className="ml-1 text-muted-foreground">· {provider}</span>
                  )}
                </Badge>
              ))}
            </div>
            {definition.model?.provider && (
              <p className="text-[11px] text-muted-foreground pt-1">
                Default brain: <span className="font-mono">{definition.model.provider}/{definition.model.model_id}</span>
                {definition.model.thinking_level && definition.model.thinking_level !== "none" && (
                  <span> · thinking: {definition.model.thinking_level}</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Skills accordion */}
      {skills.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <SectionLabel icon={Wrench} label="Skills" count={skills.length} />
            <p className="text-[11px] text-muted-foreground">Bundles installed on the agent. Each carries its full SKILL.md plus any supporting files.</p>
            <div className="space-y-1 pt-2">
              {skills.map((s) => <SkillRow key={s.slug} skill={s} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integrations / Credentials / Channels — requirements */}
      {(integrations.length > 0 || credentials.length > 0 || channels.length > 0) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <SectionLabel icon={Plug} label="Required to fully run" />
            {integrations.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Integrations</p>
                <div className="flex flex-wrap gap-1">
                  {integrations.map((i) => (
                    <Badge key={i.service} variant="secondary" className="text-[10px]">{i.service}</Badge>
                  ))}
                </div>
              </div>
            )}
            {credentials.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Credentials</p>
                <div className="flex flex-wrap gap-1">
                  {credentials.map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-mono">
                      {c.kind}:{c.provider}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {channels.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Channels</p>
                <div className="flex flex-wrap gap-1">
                  {channels.map((c, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{c.type}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Approval rules */}
      {rules.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <SectionLabel icon={Shield} label="Auto-approval rules" count={rules.length} />
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="pb-2 pr-2">Label</th>
                  <th className="pb-2 pr-2">Payload</th>
                  <th className="pb-2 pr-2">Decision</th>
                  <th className="pb-2 pr-2">Predicate</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1.5 pr-2 font-medium">{r.label || "—"}</td>
                    <td className="py-1.5 pr-2 font-mono text-[10px]">{r.payload_type || "any"}</td>
                    <td className="py-1.5 pr-2">
                      <span className={r.auto_decision === "approve" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                        {r.auto_decision}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-muted-foreground">{JSON.stringify(r.predicate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Persona — identity / personality / instructions */}
      {([
        { label: "Identity",        body: definition.persona?.identity_md ?? template.identity_md },
        { label: "Personality",     body: definition.persona?.personality_md ?? template.personality_md },
        { label: "Instructions",    body: definition.persona?.instructions_md ?? template.instructions_md },
        { label: "Email signature", body: definition.persona?.email_signature_md },
      ] as const).map((sec) =>
        sec.body && sec.body.trim().length > 0 ? (
          <Card key={sec.label}>
            <CardContent className="p-5 space-y-2">
              <SectionLabel icon={ScrollText} label={sec.label} />
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.body}</ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        ) : null,
      )}

      {/* Footer metadata */}
      {definition.metadata && (
        <p className="text-[10px] text-muted-foreground pt-2">
          Exported {definition.metadata.exported_at && new Date(definition.metadata.exported_at).toLocaleString()}
          {definition.metadata.exported_by?.name && ` by ${definition.metadata.exported_by.name}`}
        </p>
      )}
    </div>
  )
}

function SectionLabel({ icon: Icon, label, count }: { icon: typeof Zap; label: string; count?: number }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
      {count !== undefined && <span className="text-muted-foreground/70">· {count}</span>}
    </h3>
  )
}

function SkillRow({ skill }: { skill: SkillBundle }) {
  const [open, setOpen] = useState(false)
  const md = skill.files?.find((f) => f.path?.toLowerCase() === "skill.md")?.content
  const extras = (skill.files || []).filter((f) => f.path?.toLowerCase() !== "skill.md")
  return (
    <div className="rounded border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40"
      >
        {open ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
        <span className="font-medium">{skill.name || skill.slug}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{skill.slug}</span>
        {skill.category && (
          <span className="ml-auto text-[10px] text-muted-foreground">{skill.category}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2 text-[11px]">
          {skill.description && <p className="text-muted-foreground">{skill.description}</p>}
          {(skill.requires_connections?.length || skill.required_capabilities?.length) ? (
            <div className="flex flex-wrap gap-1">
              {skill.requires_connections?.map((c) => (
                <Badge key={c} variant="outline" className="text-[10px]">needs: {c}</Badge>
              ))}
              {skill.required_capabilities?.map((c) => (
                <Badge key={c} variant="outline" className="text-[10px]">cap: {c}</Badge>
              ))}
            </div>
          ) : null}
          {md && (
            <details className="text-[11px]" open>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">SKILL.md</summary>
              <article className="prose prose-sm dark:prose-invert max-w-none mt-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
              </article>
            </details>
          )}
          {extras.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                {extras.length} supporting file{extras.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 space-y-2">
                {extras.map((f, i) => (
                  <li key={i}>
                    <p className="font-mono text-[10px] text-muted-foreground mb-1">{f.path}</p>
                    <pre className="rounded border bg-background p-2 text-[10.5px] font-mono overflow-auto max-h-48 whitespace-pre-wrap">{f.content}</pre>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
