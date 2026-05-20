import { Head, router, useForm, usePage } from "@inertiajs/react"
import { useEffect, useState } from "react"
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Zap,
  XCircle,
  RefreshCw,
  Edit2,
  Save,
  Eye,
  ArrowLeft,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import AdminLayout from "@/layouts/admin-layout"
import { Button } from "@/components/ui/button"

// ── Types ───────────────────────────────────────────────────────────

interface ResolvedSkill {
  capability: string
  slug: string
  name: string
  category: string | null
  via: string
  exists_in_db: boolean
  would_create: boolean
  composio_toolkit: string | null
}

interface PreviewPayload {
  template_attrs: {
    slug: string
    name: string
    role: string
    category: string
    description: string
    icon: string | null
    identity_md: string
    personality_md: string
    instructions_md: string
    email_signature_md: string | null
    suggested_skill_slugs: string[]
    suggested_integrations: string[]
    suggested_model: string
    suggested_provider: string
  }
  requirements: Array<{ capability: string; query: string; priority: string; composio_toolkit: string | null }>
  resolved_skills: ResolvedSkill[]
  unresolved_capabilities: string[]
  lint: { pass: boolean; score: number; warnings: Array<{ rule: string; message: string }> }
  duplicates: Array<{ slug: string; name: string; score: number }>
}

interface PreviewState {
  status: "queued" | "running" | "done" | "errored"
  preview?: PreviewPayload
  error?: string
}

interface Props {
  categories: string[]
  form: { description: string; name: string; role: string; category: string }
  preview_token: string | null
  preview_state: PreviewState | null
}

// ── Page ───────────────────────────────────────────────────────────

export default function AdminTemplatesNew({ categories, form: initialForm, preview_token, preview_state }: Props) {
  const { props } = usePage()
  const flash = (props as { flash?: { error?: string } }).flash || {}

  const preview = preview_state?.preview
  const isJobRunning = preview_token != null && preview_state != null &&
    (preview_state.status === "queued" || preview_state.status === "running")

  const [draftStage, setDraftStage] = useState<0 | 1 | 2 | 3>(0)

  // Form for step 1 (the brief).
  const draftForm = useForm({
    description: initialForm.description,
    name: initialForm.name,
    role: initialForm.role,
    category: initialForm.category,
  })

  // Poll while the background job is in flight. Inertia reload with
  // only:["preview_state"] keeps the form state intact.
  useEffect(() => {
    if (!isJobRunning) {
      setDraftStage(0)
      return
    }
    setDraftStage(1)
    const t1 = setTimeout(() => setDraftStage(2), 1500)
    const t2 = setTimeout(() => setDraftStage(3), 4500)
    const interval = setInterval(() => {
      router.reload({ only: ["preview_state"], preserveScroll: true })
    }, 2000)
    return () => { clearInterval(interval); clearTimeout(t1); clearTimeout(t2) }
  }, [isJobRunning])

  // Local copy of the preview's editable fields. Updated by the user
  // clicking Edit on a markdown card. Synced when a fresh preview comes
  // in from a Draft or Regenerate.
  const [edited, setEdited] = useState({
    identity_md: preview?.template_attrs?.identity_md || "",
    personality_md: preview?.template_attrs?.personality_md || "",
    instructions_md: preview?.template_attrs?.instructions_md || "",
    email_signature_md: preview?.template_attrs?.email_signature_md || "",
  })
  useEffect(() => {
    if (preview?.template_attrs) {
      setEdited({
        identity_md: preview.template_attrs.identity_md || "",
        personality_md: preview.template_attrs.personality_md || "",
        instructions_md: preview.template_attrs.instructions_md || "",
        email_signature_md: preview.template_attrs.email_signature_md || "",
      })
    }
  }, [preview?.template_attrs?.slug])

  function submitDraft(e?: React.FormEvent) {
    if (e) e.preventDefault()
    draftForm.post("/admin/templates/draft", {
      preserveScroll: true,
    })
  }

  function commit() {
    if (!preview?.template_attrs) return
    const attrs = preview.template_attrs
    router.post("/admin/templates/commit", {
      brief: {
        slug: attrs.slug,
        name: attrs.name,
        role: attrs.role,
        category: attrs.category,
        description: attrs.description,
      },
      identity_md: edited.identity_md,
      personality_md: edited.personality_md,
      instructions_md: edited.instructions_md,
      email_signature_md: edited.email_signature_md,
    })
  }

  function backToEditPrompt() {
    // Re-render the same page without the preview prop by visiting #new.
    router.visit("/admin/templates/new", {
      data: draftForm.data,
      method: "get",
      preserveState: false,
    })
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Templates", href: "/admin/templates" }, { label: "Create with AI" }]}>
      <Head title="Create template with AI" />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-purple-600" />
          <h1 className="text-2xl font-semibold">Create template with AI</h1>
        </div>

        {flash.error && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            {flash.error}
          </div>
        )}

        {/* STEP 1: form (always visible — even with preview present, user can re-edit) */}
        <form onSubmit={submitDraft} className="rounded-lg border bg-card p-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">What should this agent do?</label>
            <textarea
              value={draftForm.data.description}
              onChange={(e) => draftForm.setData("description", e.target.value)}
              rows={4}
              placeholder="An SDR for a B2B SaaS — sources prospects on LinkedIn, drafts personalized cold emails, hands warm replies to AEs. Reports to Marketing."
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Describe the role like you'd describe a new hire on day one. Be specific about outcomes, tools, and what NOT to do.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Name (optional)</label>
              <input
                value={draftForm.data.name}
                onChange={(e) => draftForm.setData("name", e.target.value)}
                placeholder="auto"
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Role title (optional)</label>
              <input
                value={draftForm.data.role}
                onChange={(e) => draftForm.setData("role", e.target.value)}
                placeholder="auto"
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Category</label>
              <select
                value={draftForm.data.category}
                onChange={(e) => draftForm.setData("category", e.target.value)}
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">auto</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.visit("/admin/templates")}>
              <ArrowLeft className="size-3.5 mr-1.5" />
              Back to templates
            </Button>
            <Button type="submit" disabled={isJobRunning || !draftForm.data.description.trim()}>
              <Sparkles className="size-3.5 mr-1.5" />
              {isJobRunning ? draftStageLabel(draftStage) : preview ? "Regenerate" : "Draft this template"}
            </Button>
          </div>
        </form>

        {/* In-flight progress card */}
        {isJobRunning && (
          <div className="rounded-md border border-purple-300 bg-purple-50 dark:bg-purple-950/30 p-4 text-sm">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-4 animate-spin text-purple-600" />
              <span className="font-semibold">{draftStageLabel(draftStage)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground ml-6">
              Running in the background. This takes 30-60s — page polls every 2s.
              You can leave the tab open or come back later (the URL has the job token).
            </p>
          </div>
        )}

        {preview_state?.status === "errored" && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            <strong>Preview failed:</strong> {preview_state.error || "Unknown error"}
          </div>
        )}

        {preview?.template_attrs && (
          <>
            <QualityBanner lint={preview.lint} />
            {preview.duplicates && preview.duplicates.length > 0 && (
              <DuplicatesWarning duplicates={preview.duplicates} />
            )}

            <SkillResolutionTable resolved={preview.resolved_skills || []} unresolved={preview.unresolved_capabilities || []} />

            <PreviewSection
              label="Identity"
              value={edited.identity_md}
              onChange={(v) => setEdited((p) => ({ ...p, identity_md: v }))}
            />
            <PreviewSection
              label="Personality"
              value={edited.personality_md}
              onChange={(v) => setEdited((p) => ({ ...p, personality_md: v }))}
            />
            <PreviewSection
              label="Instructions"
              value={edited.instructions_md}
              onChange={(v) => setEdited((p) => ({ ...p, instructions_md: v }))}
            />
            <PreviewSection
              label="Email signature"
              value={edited.email_signature_md}
              onChange={(v) => setEdited((p) => ({ ...p, email_signature_md: v }))}
              compact
            />

            {/* Action row */}
            <div className="sticky bottom-0 -mx-6 border-t border-border bg-card/95 backdrop-blur px-6 py-3 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{preview.template_attrs.slug}</span> · {preview.template_attrs.role} · {preview.template_attrs.category}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={backToEditPrompt}>
                  <Edit2 className="size-3.5 mr-1.5" /> Edit prompt
                </Button>
                <Button variant="ghost" onClick={submitDraft} disabled={isJobRunning}>
                  <RefreshCw className={`size-3.5 mr-1.5 ${isJobRunning ? "animate-spin" : ""}`} /> Regenerate
                </Button>
                <Button onClick={commit}>
                  <Save className="size-3.5 mr-1.5" /> Create template
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

function draftStageLabel(stage: number): string {
  switch (stage) {
    case 1: return "Analyzing capabilities…"
    case 2: return "Resolving skills…"
    case 3: return "Drafting identity…"
    default: return "Drafting…"
  }
}

function QualityBanner({ lint }: { lint?: { pass: boolean; score: number; warnings: Array<{ rule: string; message: string }> } }) {
  if (!lint) return null
  const color = lint.pass
    ? "border-green-300 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300"
    : "border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300"
  const Icon = lint.pass ? CheckCircle2 : AlertTriangle
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-4" />
        <span className="text-sm font-semibold">
          Quality score: {lint.score} / 100 · {lint.pass ? "PASS — ready to publish" : `${lint.warnings.length} warning${lint.warnings.length === 1 ? "" : "s"} — review before creating`}
        </span>
      </div>
      {lint.warnings.length > 0 && (
        <ul className="mt-2 ml-6 list-disc space-y-1 text-xs">
          {lint.warnings.map((w, i) => (
            <li key={i}><span className="font-mono">[{w.rule}]</span> {w.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DuplicatesWarning({ duplicates }: { duplicates: Array<{ slug: string; name: string; score: number }> }) {
  return (
    <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-300 text-blue-800 p-3 text-xs">
      <div className="font-semibold mb-1">⚠ Near-duplicates exist</div>
      <ul className="ml-4 list-disc">
        {duplicates.map((d) => (
          <li key={d.slug}>{d.name} <span className="font-mono">({d.slug})</span> — similarity {(d.score * 100).toFixed(0)}%</li>
        ))}
      </ul>
    </div>
  )
}

function SkillResolutionTable({ resolved, unresolved }: { resolved: ResolvedSkill[]; unresolved: string[] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Skills this template will use</h2>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="pb-2 pr-2">Status</th>
            <th className="pb-2 pr-2">Capability</th>
            <th className="pb-2 pr-2">Skill slug</th>
            <th className="pb-2 pr-2">Composio</th>
          </tr>
        </thead>
        <tbody>
          {resolved.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="py-1.5 pr-2">
                {r.exists_in_db ? (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="size-3" /> existing
                  </span>
                ) : r.would_create ? (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <Zap className="size-3" /> will generate
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-1.5 pr-2">{r.capability}</td>
              <td className="py-1.5 pr-2 font-mono">{r.slug}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">{r.composio_toolkit || "—"}</td>
            </tr>
          ))}
          {unresolved.map((c, i) => (
            <tr key={`u${i}`} className="border-t">
              <td className="py-1.5 pr-2">
                <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                  <XCircle className="size-3" /> unresolved
                </span>
              </td>
              <td className="py-1.5 pr-2">{c}</td>
              <td className="py-1.5 pr-2 text-muted-foreground">—</td>
              <td className="py-1.5 pr-2 text-muted-foreground">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PreviewSection({ label, value, onChange, compact }: { label: string; value: string; onChange: (v: string) => void; compact?: boolean }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {editing ? <><Eye className="size-3" /> Preview</> : <><Edit2 className="size-3" /> Edit</>}
        </button>
      </div>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={compact ? 4 : Math.min(30, Math.max(8, value.split("\n").length + 2))}
          className="w-full rounded border bg-background px-2 py-1.5 text-xs font-mono"
        />
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {value ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <span className="italic text-muted-foreground">(empty)</span>
          )}
        </div>
      )}
    </section>
  )
}
