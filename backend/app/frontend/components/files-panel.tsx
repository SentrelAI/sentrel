import { router, usePage } from "@inertiajs/react"
import { useState, useRef, DragEvent } from "react"
import { FolderOpen, Upload, FileText, Trash2, X, AlertCircle, CheckCircle2, Users, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

// A whole file the agent can browse + read in full via the engine
// list_files / read_file tools. Not vectorized — sibling to KnowledgeDocument.
export interface AgentFile {
  id: number
  title: string
  description: string | null
  filename: string
  content_type: string | null
  byte_size: number | null
  signed_id: string | null
  scope: "agent" | "org"
  created_at: string | null
}

interface FilesPanelProps {
  agentId: string
  agentName: string
  files: AgentFile[]
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(s: string | null): string {
  if (!s) return "—"
  return new Date(s).toLocaleString()
}

export default function FilesPanel({ agentId, agentName, files }: FilesPanelProps) {
  const page = usePage<{ flash?: { success?: string; error?: string } }>()
  const flashNotice = page.props.flash?.success
  const flashAlert = page.props.flash?.error

  const [dragging, setDragging] = useState(false)
  const [scope, setScope] = useState<"agent" | "org">("agent")
  const [queued, setQueued] = useState<File[]>([])
  const [title, setTitle] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const csrfToken =
    typeof document !== "undefined"
      ? document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
      : ""

  function addFiles(list: FileList | File[]) {
    setQueued((prev) => [...prev, ...Array.from(list)])
  }
  function removeFile(idx: number) {
    setQueued((prev) => prev.filter((_, i) => i !== idx))
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
      for (const f of queued) fd.append("files[]", f)
      const res = await fetch(`/agents/${agentId}/files`, {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: fd,
      })
      if (!res.ok) {
        setUploadError(`Upload failed (HTTP ${res.status})`)
        return
      }
      setQueued([])
      setTitle("")
      router.reload()
    } catch (err) {
      setUploadError((err as Error).message || "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: number) {
    if (!confirm("Remove this file from the agent?")) return
    await fetch(`/agents/${agentId}/files/${fileId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    })
    router.reload()
  }

  async function handlePromote(fileId: number) {
    if (!confirm("Promote this file to the org-shared library? Every agent in this org will be able to read it.")) return
    await fetch(`/agents/${agentId}/files/${fileId}/promote`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
    })
    router.reload()
  }

  return (
    <div className="overflow-y-auto h-full p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">{agentName} · Files</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Whole files the agent can browse and read in full — no vectorization. Best for specs, contracts, and
          reference docs. Adding the first file automatically enables the file finder.
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

      <div className="rounded-lg border border-border p-5 mb-6">
        <h2 className="text-sm font-medium mb-3">Add files</h2>

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
                ? "Available only to this agent."
                : "Available to every agent in the org."}
            </div>
          </div>
          <input
            type="text"
            placeholder={queued.length > 1 ? "Title (applied to all files, optional)" : "Title (optional — defaults to filename)"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
          />

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
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.currentTarget.value = ""
              }}
            />
            <Upload className="size-6 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm">Drop files or click to browse</div>
            <div className="text-xs text-muted-foreground mt-1">
              Any document · the agent reads PDF, DOCX, HTML, Markdown, and text in full · multiple allowed
            </div>
          </div>

          {queued.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                {queued.length} file{queued.length === 1 ? "" : "s"} queued
              </div>
              {queued.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button type="button" onClick={() => removeFile(i)} className="p-1 rounded hover:bg-muted">
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button type="submit" size="sm" disabled={uploading || queued.length === 0}>
            {uploading ? "Uploading..." : queued.length > 1 ? `Add ${queued.length} files` : "Add file"}
          </Button>
        </form>
      </div>

      <div>
        <h2 className="text-sm font-medium mb-3">Available files ({files.length})</h2>
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
            <FolderOpen className="size-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium mb-1">No files yet</p>
            <p className="text-xs text-muted-foreground">Add a file above to make it available to your agent</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">File</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                  <th className="text-right px-3 py-2 font-medium">Size</th>
                  <th className="text-left px-3 py-2 font-medium">Added</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={`${f.scope}-${f.id}`} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{f.title}</span>
                        {f.scope === "org" && (
                          <Badge variant="secondary" className="text-[9px] uppercase tracking-wide">Org</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">{f.content_type || "unknown"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">{fmtSize(f.byte_size)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(f.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {f.signed_id && (
                          <a
                            href={`/api/blobs/${f.signed_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Download"
                          >
                            <Download className="size-3.5" />
                          </a>
                        )}
                        {f.scope !== "org" && (
                          <button
                            onClick={() => handlePromote(f.id)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Promote to org library"
                          >
                            <Users className="size-3.5" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(f.id)} className="p-1 rounded hover:bg-red-500/10 text-red-500" title="Remove">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
