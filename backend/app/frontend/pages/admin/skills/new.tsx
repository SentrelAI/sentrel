import { Head, router, useForm, usePage } from "@inertiajs/react"
import { useEffect, useState } from "react"
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Edit2,
  Save,
  Eye,
  ArrowLeft,
  FileText,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import AdminLayout from "@/layouts/admin-layout"
import { Button } from "@/components/ui/button"

interface PreviewPayload {
  skill_attrs: {
    slug: string
    name: string
    description: string
    category: string
    icon: string
    requires_connections: string[]
    required_capabilities: string[]
    skill_md: string
  }
  additional_files: Array<{ path: string; content: string }>
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
  form: { description: string; name: string; category: string; requires_connections: string }
  preview_token: string | null
  preview_state: PreviewState | null
}

export default function AdminSkillsNew({ categories, form: initialForm, preview_token, preview_state }: Props) {
  const { props } = usePage()
  const flash = (props as { flash?: { error?: string } }).flash || {}

  const preview = preview_state?.preview
  const isJobRunning = preview_token != null && preview_state != null &&
    (preview_state.status === "queued" || preview_state.status === "running")

  const [draftStage, setDraftStage] = useState<0 | 1 | 2 | 3>(0)

  const draftForm = useForm({
    description: initialForm.description,
    name: initialForm.name,
    category: initialForm.category,
    requires_connections: initialForm.requires_connections,
  })

  useEffect(() => {
    if (!isJobRunning) {
      setDraftStage(0)
      return
    }
    setDraftStage(1)
    const t1 = setTimeout(() => setDraftStage(2), 1500)
    const t2 = setTimeout(() => setDraftStage(3), 4500)
    const interval = setInterval(() => {
      router.reload({ only: ["preview_state"] })
    }, 2000)
    return () => { clearInterval(interval); clearTimeout(t1); clearTimeout(t2) }
  }, [isJobRunning])

  const [editedSkillMd, setEditedSkillMd] = useState(preview?.skill_attrs?.skill_md || "")
  useEffect(() => {
    if (preview?.skill_attrs) {
      setEditedSkillMd(preview.skill_attrs.skill_md || "")
    }
  }, [preview?.skill_attrs?.slug])

  function submitDraft(e?: React.FormEvent) {
    if (e) e.preventDefault()
    draftForm.post("/admin/skills/draft", { preserveScroll: true })
  }

  function commit() {
    if (!preview?.skill_attrs) return
    const attrs = preview.skill_attrs
    router.post("/admin/skills/commit", {
      brief: {
        slug: attrs.slug,
        name: attrs.name,
        category: attrs.category,
        description: attrs.description,
        icon: attrs.icon,
      },
      skill_md: editedSkillMd,
    })
  }

  function backToEditPrompt() {
    router.visit("/admin/skills/new", {
      data: draftForm.data,
      method: "get",
      preserveState: false,
    })
  }

  return (
    <AdminLayout crumbs={[{ label: "Admin" }, { label: "Skills", href: "/admin/skills" }, { label: "Create with AI" }]}>
      <Head title="Create skill with AI" />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-purple-600" />
          <h1 className="text-2xl font-semibold">Create skill with AI</h1>
        </div>

        {flash.error && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            {flash.error}
          </div>
        )}

        <form onSubmit={submitDraft} className="rounded-lg border bg-card p-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">What should this skill do?</label>
            <textarea
              value={draftForm.data.description}
              onChange={(e) => draftForm.setData("description", e.target.value)}
              rows={4}
              placeholder="Send a Stripe invoice to a customer and poll until paid. Handles 422/payment-failed and timeouts. Marks the related Conversation as billed."
              className="w-full rounded border bg-background px-3 py-2 text-sm"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Describe the capability like a runbook — what the agent does, what tools/APIs it uses, what NOT to do.
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
            <div>
              <label className="mb-1 block text-xs font-medium">Required connections</label>
              <input
                value={draftForm.data.requires_connections}
                onChange={(e) => draftForm.setData("requires_connections", e.target.value)}
                placeholder="stripe, slack"
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.visit("/admin/skills")}>
              <ArrowLeft className="size-3.5 mr-1.5" />
              Back to skills
            </Button>
            <Button type="submit" disabled={isJobRunning || !draftForm.data.description.trim()}>
              <Sparkles className="size-3.5 mr-1.5" />
              {isJobRunning ? draftStageLabel(draftStage) : preview ? "Regenerate" : "Draft this skill"}
            </Button>
          </div>
        </form>

        {isJobRunning && (
          <div className="rounded-md border border-purple-300 bg-purple-50 dark:bg-purple-950/30 p-4 text-sm">
            <div className="flex items-center gap-2">
              <RefreshCw className="size-4 animate-spin text-purple-600" />
              <span className="font-semibold">{draftStageLabel(draftStage)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground ml-6">
              Running in the background. Takes 20-40s — page polls every 2s.
            </p>
          </div>
        )}

        {preview_state?.status === "errored" && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            <strong>Preview failed:</strong> {preview_state.error || "Unknown error"}
          </div>
        )}

        {preview?.skill_attrs && (
          <>
            <QualityBanner lint={preview.lint} />
            {preview.duplicates && preview.duplicates.length > 0 && (
              <DuplicatesWarning duplicates={preview.duplicates} />
            )}

            <SkillMetaCard attrs={preview.skill_attrs} />

            <SkillMdEditor value={editedSkillMd} onChange={setEditedSkillMd} />

            {preview.additional_files.length > 0 && (
              <AdditionalFilesCard files={preview.additional_files} />
            )}

            <div className="sticky bottom-0 -mx-6 border-t border-border bg-card/95 backdrop-blur px-6 py-3 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{preview.skill_attrs.slug}</span> · {preview.skill_attrs.category}
                {preview.skill_attrs.requires_connections.length > 0 && (
                  <> · needs: {preview.skill_attrs.requires_connections.join(", ")}</>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={backToEditPrompt}>
                  <Edit2 className="size-3.5 mr-1.5" /> Edit prompt
                </Button>
                <Button variant="ghost" onClick={submitDraft} disabled={isJobRunning}>
                  <RefreshCw className={`size-3.5 mr-1.5 ${isJobRunning ? "animate-spin" : ""}`} /> Regenerate
                </Button>
                <Button onClick={commit}>
                  <Save className="size-3.5 mr-1.5" /> Create skill
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}

function draftStageLabel(stage: number): string {
  switch (stage) {
    case 1: return "Analyzing brief…"
    case 2: return "Drafting SKILL.md…"
    case 3: return "Quality lint…"
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
      <div className="font-semibold mb-1">⚠ Existing skill(s) with the same slug or name</div>
      <ul className="ml-4 list-disc">
        {duplicates.map((d) => (
          <li key={d.slug}>{d.name} <span className="font-mono">({d.slug})</span>{d.score >= 1 && <span> — exact slug match, commit will overwrite this row</span>}</li>
        ))}
      </ul>
    </div>
  )
}

function SkillMetaCard({ attrs }: { attrs: PreviewPayload["skill_attrs"] }) {
  return (
    <section className="rounded-lg border bg-card p-4 text-sm">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Meta label="Slug" value={attrs.slug} mono />
        <Meta label="Category" value={attrs.category} />
        <Meta label="Icon" value={attrs.icon} mono />
        <Meta label="Connections" value={attrs.requires_connections.join(", ") || "—"} />
      </div>
      <div className="mt-3">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">Description</div>
        <div className="mt-0.5">{attrs.description}</div>
      </div>
    </section>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  )
}

function SkillMdEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">SKILL.md</h3>
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
          rows={Math.min(40, Math.max(12, value.split("\n").length + 2))}
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

function AdditionalFilesCard({ files }: { files: Array<{ path: string; content: string }> }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <section className="rounded-lg border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">
        Supporting files <span className="text-xs font-normal text-muted-foreground">({files.length}) — read-only preview</span>
      </h3>
      <ul className="space-y-1">
        {files.map((f, i) => (
          <li key={f.path} className="border-t pt-1 first:border-t-0 first:pt-0">
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="flex w-full items-center gap-2 py-1 text-left text-xs hover:bg-muted/40"
            >
              <FileText className="size-3 text-muted-foreground" />
              <span className="font-mono">{f.path}</span>
              <span className="text-muted-foreground">({f.content.split("\n").length} lines)</span>
            </button>
            {openIdx === i && (
              <pre className="mt-1 max-h-64 overflow-auto rounded border bg-background p-2 text-[11px] font-mono whitespace-pre-wrap">{f.content}</pre>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
