import { Head, Link, router } from "@inertiajs/react"
import { useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  FileText,
  Plus,
  Save,
  Trash2,
  Rocket,
  EyeOff,
  FolderPlus,
} from "lucide-react"
import { toast } from "sonner"

import AppLayout from "@/layouts/app-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CodeMirrorEditor } from "@/components/codemirror-editor"
import { cn } from "@/lib/utils"

type FileType = "md" | "py" | "js" | "ts" | "json" | "yaml" | "sh" | "rb" | "text" | "other"

interface SkillFile {
  id: number | null   // null = newly added, not yet saved
  path: string
  content: string
  file_type: FileType
  position: number
  _delete?: boolean
  _dirty?: boolean
}

interface Skill {
  slug: string
  name: string
  description: string | null
  category: string | null
  visibility: "private" | "org" | "marketplace"
  published: boolean
  version: number
  install_count: number
  files: Array<{ id: number; path: string; content: string; file_type: FileType; position: number }>
}

interface Props {
  skill: Skill
}

const EXT_TO_TYPE: Record<string, FileType> = {
  md: "md", markdown: "md",
  py: "py",
  js: "js", mjs: "js",
  ts: "ts", tsx: "ts",
  json: "json",
  yaml: "yaml", yml: "yaml",
  sh: "sh", bash: "sh",
  rb: "rb",
  txt: "text", csv: "text",
}

function inferType(path: string): FileType {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXT_TO_TYPE[ext] || "other"
}

function csrf(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
}

export default function SkillEdit({ skill }: Props) {
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description || "")
  const [files, setFiles] = useState<SkillFile[]>(() =>
    skill.files.map((f) => ({ ...f, _dirty: false, _delete: false })),
  )
  const [activePath, setActivePath] = useState<string>(files[0]?.path ?? "SKILL.md")
  const [saving, setSaving] = useState(false)
  const [metaDirty, setMetaDirty] = useState(false)

  const visibleFiles = useMemo(() => files.filter((f) => !f._delete), [files])
  const activeFile = useMemo(() => visibleFiles.find((f) => f.path === activePath) || visibleFiles[0], [visibleFiles, activePath])
  const dirty = metaDirty || files.some((f) => f._dirty || f._delete || f.id === null)

  // ⌘S / Ctrl+S to save while typing in the editor — saves files via a fetch
  // without leaving the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, name, description])

  function patchFile(path: string, patch: Partial<SkillFile>) {
    setFiles((prev) => prev.map((f) => (f.path === path && !f._delete ? { ...f, ...patch, _dirty: true } : f)))
  }

  function addFile() {
    const proposed = window.prompt("File path (e.g. helpers/parser.py, schemas/request.json):", "")
    if (!proposed) return
    const cleaned = proposed.trim().replace(/^\/+/, "")
    if (visibleFiles.some((f) => f.path === cleaned)) {
      toast.error(`File "${cleaned}" already exists`)
      return
    }
    setFiles((prev) => [
      ...prev,
      {
        id: null,
        path: cleaned,
        content: "",
        file_type: inferType(cleaned),
        position: prev.length,
        _dirty: true,
      },
    ])
    setActivePath(cleaned)
  }

  function renameFile(file: SkillFile) {
    const next = window.prompt("New path:", file.path)?.trim()
    if (!next || next === file.path) return
    if (visibleFiles.some((f) => f.path === next && f !== file)) {
      toast.error(`A file at "${next}" already exists`)
      return
    }
    setFiles((prev) => prev.map((f) => (f === file ? { ...f, path: next, file_type: inferType(next), _dirty: true } : f)))
    setActivePath(next)
  }

  function deleteFile(file: SkillFile) {
    if (file.path === "SKILL.md") {
      toast.error("SKILL.md is required — edit its content instead")
      return
    }
    if (!confirm(`Delete ${file.path}?`)) return
    setFiles((prev) => prev.map((f) => (f === file ? { ...f, _delete: true } : f)))
    // Jump to next surviving file
    const remaining = visibleFiles.filter((f) => f !== file)
    setActivePath(remaining[0]?.path ?? "SKILL.md")
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        skill: { name, description },
        files: files.map((f) => ({
          id: f.id,
          path: f.path,
          content: f.content,
          file_type: f.file_type,
          position: f.position,
          _delete: f._delete || false,
        })),
      }
      const res = await fetch(`/skills/${skill.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf(), "Accept": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success("Saved")
      // Drop the dirty / deleted state, hydrate any new ids from the round-trip
      router.reload({ only: ["skill"] })
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  function publish() {
    if (!confirm(`Publish v${skill.version + 1}? Installed agents will pick it up on their next sync.`)) return
    router.post(`/skills/${skill.slug}/publish`, {}, { headers: { "X-CSRF-Token": csrf() } })
  }
  function unpublish() {
    router.post(`/skills/${skill.slug}/unpublish`, {}, { headers: { "X-CSRF-Token": csrf() } })
  }

  return (
    <AppLayout
      fullBleed
      crumbs={[
        { label: "Workspace", href: "/" },
        { label: "Skills", href: "/skills" },
        { label: skill.name, href: `/skills/${skill.slug}` },
        { label: "Edit" },
      ]}
      topBarActions={
        <div className="flex items-center gap-2">
          {dirty && <Badge variant="outline" className="text-[10px]">Unsaved</Badge>}
          <Button size="sm" variant="outline" onClick={save} disabled={saving || !dirty}>
            <Save className="size-3.5 mr-1.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
          {skill.published ? (
            <Button size="sm" variant="outline" onClick={unpublish}>
              <EyeOff className="size-3.5 mr-1.5" />
              Unpublish
            </Button>
          ) : (
            <Button size="sm" onClick={publish} disabled={dirty}>
              <Rocket className="size-3.5 mr-1.5" />
              Publish v{skill.version + 1}
            </Button>
          )}
        </div>
      }
    >
      <Head title={`${skill.name} · editor`} />

      {/* The outer flex needs an explicit viewport-relative height because
          AppLayout's <main> is flex-1 inside SidebarInset, but the layout
          tree above us isn't always tall enough for h-full to resolve to
          a real number. Subtract the top-bar (~52px) so this fits the
          viewport without overflowing. */}
      <div className="flex min-h-0" style={{ height: "calc(100vh - 52px)" }}>
        {/* Left: file tree + metadata */}
        <aside className="w-64 shrink-0 border-r border-border flex flex-col bg-muted/20">
          <div className="p-3 space-y-3 border-b border-border">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Link href={`/skills/${skill.slug}`} className="hover:text-foreground inline-flex items-center gap-1">
                <ArrowLeft className="size-3" />
                Back
              </Link>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setMetaDirty(true) }}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Description</Label>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setMetaDirty(true) }}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-y"
              />
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
            <button onClick={addFile} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <FolderPlus className="size-3" /> Add
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {visibleFiles.map((f) => {
              const isActive = activeFile?.path === f.path
              return (
                <div
                  key={`${f.id ?? "new"}-${f.path}`}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs",
                    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                  onClick={() => setActivePath(f.path)}
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="font-mono truncate flex-1">{f.path}</span>
                  {f._dirty && <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved" />}
                  {f.path !== "SKILL.md" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteFile(f) }}
                      className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80"
                      title="Delete"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              )
            })}
            {visibleFiles.length === 0 && (
              <div className="px-3 py-4 text-center text-[10px] text-muted-foreground">
                No files. Add one to start.
              </div>
            )}
          </div>
        </aside>

        {/* Right: editor */}
        <main className="flex-1 flex flex-col min-w-0 bg-background">
          {activeFile ? (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">{activeFile.path}</span>
                <Badge variant="outline" className="text-[10px] font-mono">{activeFile.file_type}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={() => renameFile(activeFile)}
                >
                  Rename
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <CodeMirrorEditor
                  value={activeFile.content}
                  fileType={activeFile.file_type}
                  onChange={(next) => patchFile(activeFile.path, { content: next })}
                  className="h-full"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-3">
              <FileText className="size-8 opacity-30" />
              <span>Pick a file from the tree to start editing.</span>
              <Button variant="outline" size="sm" onClick={addFile}>
                <Plus className="size-3.5 mr-1.5" />
                Add a file
              </Button>
            </div>
          )}
        </main>
      </div>
    </AppLayout>
  )
}
