import { useEffect, useState } from "react"
import { Overline } from "@/components/brand"

interface Policy {
  toolkit_slug: string
  preset: string
  allowed_tools: string[]
  denied_tools: string[]
  has_policy: boolean
}

interface Tool {
  slug: string
  name: string
  description?: string | null
}

const PRESETS: Array<{ value: string; label: string; hint: string }> = [
  { value: "read_only",  label: "Read-only",  hint: "GET / LIST / FETCH only — no writes" },
  { value: "read_write", label: "Read + write", hint: "Read + create / update / send (default)" },
  { value: "full",       label: "Full",        hint: "All tools, including delete + admin" },
  { value: "custom",     label: "Custom",      hint: "Pick individual tools below" },
]

// Per-toolkit ACL matrix. Lists every connected toolkit with a preset
// dropdown; if 'custom' is picked, shows individual tool checkboxes (lazy-
// fetched from /tool_policies/tools/:slug). Save batches all changes in
// one PATCH.
export function ToolPoliciesSection({ agentId }: { agentId: number }) {
  const [policies, setPolicies] = useState<Policy[] | null>(null)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [tools, setTools] = useState<Record<string, Tool[]>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    fetch(`/agents/${agentId}/tool_policies`, {
      headers: { Accept: "application/json", "X-CSRF-Token": csrf },
    })
      .then((r) => r.json())
      .then((data) => setPolicies(data.policies || []))
      .catch(() => setPolicies([]))
  }, [agentId])

  async function loadTools(slug: string) {
    if (tools[slug]) return
    const res = await fetch(`/agents/${agentId}/tool_policies/tools/${slug}`, {
      headers: { Accept: "application/json" },
    })
    const data = await res.json()
    setTools((prev) => ({ ...prev, [slug]: data.items || [] }))
  }

  function setPreset(slug: string, preset: string) {
    setPolicies((prev) =>
      (prev || []).map((p) => (p.toolkit_slug === slug ? { ...p, preset } : p)),
    )
  }

  function toggleAllowed(slug: string, toolName: string) {
    setPolicies((prev) =>
      (prev || []).map((p) => {
        if (p.toolkit_slug !== slug) return p
        const set = new Set(p.allowed_tools)
        set.has(toolName) ? set.delete(toolName) : set.add(toolName)
        return { ...p, allowed_tools: Array.from(set) }
      }),
    )
  }

  function toggleDenied(slug: string, toolName: string) {
    setPolicies((prev) =>
      (prev || []).map((p) => {
        if (p.toolkit_slug !== slug) return p
        const set = new Set(p.denied_tools)
        set.has(toolName) ? set.delete(toolName) : set.add(toolName)
        return { ...p, denied_tools: Array.from(set) }
      }),
    )
  }

  async function save() {
    if (!policies) return
    setSaving(true)
    setSaved(false)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      await fetch(`/agents/${agentId}/tool_policies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ policies }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (policies === null) {
    return <p className="text-xs text-muted-foreground mt-3">Loading permissions…</p>
  }
  if (policies.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
        No connected integrations. Connect at <a href="/integrations" className="underline">/integrations</a> first.
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <Overline>Per-tool permissions</Overline>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save permissions"}
        </button>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border">
        {policies.map((p) => (
          <div key={p.toolkit_slug} className="p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm capitalize">{p.toolkit_slug}</div>
              <div className="flex items-center gap-2">
                <select
                  value={p.preset}
                  onChange={(e) => setPreset(p.toolkit_slug, e.target.value)}
                  className="h-7 rounded-md border bg-card px-2 text-xs"
                >
                  {PRESETS.map((pp) => (
                    <option key={pp.value} value={pp.value}>{pp.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const next = openSlug === p.toolkit_slug ? null : p.toolkit_slug
                    setOpenSlug(next)
                    if (next) loadTools(p.toolkit_slug)
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {openSlug === p.toolkit_slug ? "Hide tools" : "Tools…"}
                </button>
              </div>
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {PRESETS.find((pp) => pp.value === p.preset)?.hint}
            </p>

            {openSlug === p.toolkit_slug && (
              <div className="mt-3 max-h-64 overflow-y-auto space-y-1 text-xs">
                {(tools[p.toolkit_slug] || []).map((t) => {
                  const isAllowed = p.allowed_tools.includes(t.slug)
                  const isDenied = p.denied_tools.includes(t.slug)
                  return (
                    <div key={t.slug} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[10px] truncate">{t.slug}</div>
                        {t.description && <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>}
                      </div>
                      <label className="flex items-center gap-1 text-[10px]">
                        <input type="checkbox" checked={isAllowed} onChange={() => toggleAllowed(p.toolkit_slug, t.slug)} />
                        allow
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-red-500">
                        <input type="checkbox" checked={isDenied} onChange={() => toggleDenied(p.toolkit_slug, t.slug)} />
                        deny
                      </label>
                    </div>
                  )
                })}
                {(tools[p.toolkit_slug]?.length === 0) && (
                  <p className="text-[10px] text-muted-foreground">No tools fetched yet.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
