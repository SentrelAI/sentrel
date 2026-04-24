import { router, usePage } from "@inertiajs/react"
import { useState, useRef, DragEvent } from "react"
import { BookOpen, Upload, FileText, Trash2, Link2, Database, X, AlertCircle, CheckCircle2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export interface KnowledgeDocument {
  id: number
  title: string
  source_type: string
  source_url: string | null
  chunk_count: number
  indexed_at: string | null
  created_at: string
  metadata: Record<string, unknown>
  scope?: "agent" | "org" // tags where the doc lives in the two-KB layout
}

interface KnowledgePanelProps {
  agentId: string
  agentName: string
  documents: KnowledgeDocument[]
}

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  markdown: FileText,
  text: FileText,
  url: Link2,
  html: FileText,
}

function fmtDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleString()
}

export default function KnowledgePanel({ agentId, agentName, documents }: KnowledgePanelProps) {
  const page = usePage<{ flash?: { success?: string; error?: string } }>()
  const flashNotice = page.props.flash?.success
  const flashAlert = page.props.flash?.error

  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<"file" | "url" | "text">("file")
  const [scope, setScope] = useState<"agent" | "org">("agent")
  const [files, setFiles] = useState<File[]>([])
  const [url, setUrl] = useState("")
  const [text, setText] = useState("")
  const [title, setTitle] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const csrfToken =
    typeof document !== "undefined"
      ? document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
      : ""

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list)
    setFiles((prev) => [...prev, ...arr])
  }
  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      if (title) fd.append("title", title)
      fd.append("scope", scope)
      if (mode === "file") {
        for (const f of files) fd.append("files[]", f)
      } else if (mode === "url" && url) {
        fd.append("url", url)
      } else if (mode === "text" && text) {
        fd.append("text", text)
      }
      const res = await fetch(`/agents/${agentId}/knowledge_documents`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: fd,
      })
      if (!res.ok) {
        setUploadError(`Upload failed (HTTP ${res.status})`)
        return
      }
      setFiles([])
      setUrl("")
      setText("")
      setTitle("")
      router.reload()
    } catch (err) {
      setUploadError((err as Error).message || "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(docId: number, docScope: "agent" | "org" | undefined) {
    if (!confirm("Delete this document and all its indexed chunks?")) return
    const qs = docScope === "org" ? "?scope=org" : ""
    await fetch(`/agents/${agentId}/knowledge_documents/${docId}${qs}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    })
    router.reload()
  }

  // Copy an agent-scoped doc into the org-shared KB so every other agent
  // in the org can search it. Engine dedupes on content hash, so it's safe
  // to call twice.
  async function handlePromote(docId: number) {
    if (!confirm("Promote this document to the org-shared library? Every agent in this org will be able to search it.")) return
    await fetch(`/agents/${agentId}/knowledge_documents/${docId}/promote`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
    })
    router.reload()
  }

  const totalChunks = documents.reduce((n, d) => n + (d.chunk_count || 0), 0)

  return (
    <div className="overflow-y-auto h-full p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{agentName} · Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload docs the agent should reference. Uploading the first document automatically enables the
          knowledge_base capability.
        </p>
      </div>

      {flashNotice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start gap-2">
          <CheckCircle2 className="size-4 text-emerald-600 mt-0.5" />
          <div className="text-sm text-emerald-700 dark:text-emerald-400">{flashNotice}</div>
        </div>
      )}
      {(flashAlert || uploadError) && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
          <AlertCircle className="size-4 text-red-500 mt-0.5" />
          <div className="text-sm text-red-700 dark:text-red-400">{flashAlert || uploadError}</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <StatCard icon={BookOpen} label="Documents" value={documents.length.toString()} />
        <StatCard icon={Database} label="Chunks indexed" value={totalChunks.toString()} />
        <StatCard icon={FileText} label="Store" value="SQLite + vec" sublabel="per-agent file" />
      </div>

      <div className="rounded-lg border border-border p-5 mb-6">
        <h2 className="text-sm font-medium mb-3">Add document</h2>

        <div className="flex gap-1 mb-3 border-b border-border">
          {(["file", "url", "text"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                mode === k
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "file" ? "Upload file" : k === "url" ? "From URL" : "Paste text"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            {(["agent", "org"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                  scope === s ? "bg-foreground text-background border-foreground" : "hover:bg-muted"
                }`}
              >
                {s === "agent" ? `Personal (${agentName})` : "Org-shared"}
              </button>
            ))}
            <div className="text-[10px] text-muted-foreground ml-1">
              {scope === "agent"
                ? "Indexed only for this agent."
                : "Shared with every agent in the org — good for company policies, product docs, standard responses."}
            </div>
          </div>
          <input
            type="text"
            placeholder={mode === "file" && files.length > 1 ? "Title (applied to all files, optional)" : "Title (optional)"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
          />

          {mode === "file" && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onClick={() => fileInput.current?.click()}
                className={`rounded-md border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  dragging ? "border-blue-500 bg-blue-500/5" : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept=".pdf,.md,.markdown,.txt,.html,.htm,.docx"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.currentTarget.value = ""
                  }}
                />
                <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
                <div className="text-sm">Drop files or click to browse</div>
                <div className="text-xs text-muted-foreground mt-1">
                  PDF, DOCX, Markdown, HTML, or text · multiple allowed
                </div>
              </div>

              {files.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">
                    {files.length} file{files.length === 1 ? "" : "s"} queued
                  </div>
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <FileText className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate">{f.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <button type="button" onClick={() => removeFile(i)} className="p-1 rounded hover:bg-muted">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "url" && (
            <input
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
              required
            />
          )}

          {mode === "text" && (
            <textarea
              placeholder="Paste text content here..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background font-mono"
              required
            />
          )}

          <Button
            type="submit"
            size="sm"
            disabled={
              uploading ||
              (mode === "file" && files.length === 0) ||
              (mode === "url" && !url) ||
              (mode === "text" && !text)
            }
          >
            {uploading ? "Ingesting..." : mode === "file" && files.length > 1 ? `Index ${files.length} documents` : "Index document"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-3">
          Ingestion takes 5-30s depending on document size. Text is chunked, each chunk gets an AI-generated context prefix
          (Anthropic Contextual Retrieval), then embedded locally.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-3">Indexed documents ({documents.length})</h2>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
            <BookOpen className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium mb-1">No documents yet</p>
            <p className="text-xs text-muted-foreground">Upload a file above to give your agent knowledge to reference</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Document</th>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                  <th className="text-right px-3 py-2 font-medium">Chunks</th>
                  <th className="text-left px-3 py-2 font-medium">Indexed</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const Icon = SOURCE_ICONS[doc.source_type] || FileText
                  return (
                    <tr key={doc.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Icon className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{doc.title}</span>
                          {doc.scope === "org" && (
                            <Badge variant="secondary" className="text-[9px] uppercase tracking-wide">Org</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <Badge variant="outline" className="text-[10px]">{doc.source_type}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums">{doc.chunk_count}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(doc.indexed_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {doc.scope !== "org" && (
                            <button
                              onClick={() => handlePromote(doc.id)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Promote to org library"
                            >
                              <Users className="size-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleDelete(doc.id, doc.scope)} className="p-1 rounded hover:bg-red-500/10 text-red-500" title="Delete">
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sublabel?: string
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>}
    </div>
  )
}
