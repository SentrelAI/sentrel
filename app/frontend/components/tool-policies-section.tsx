import { useEffect, useState } from "react"
import { ChevronRight, Check } from "lucide-react"
import { Overline } from "@/components/brand"
import { cn } from "@/lib/utils"

interface Policy {
  toolkit_slug: string
  label?: string
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

const PRESETS: Array<{ value: string; label: string; description: string }> = [
  { value: "read_only",  label: "View only",   description: "Search, list, and fetch — no changes" },
  { value: "read_write", label: "Read + write", description: "View, create, update, and send" },
  { value: "full",       label: "Full access",  description: "Everything, including delete and admin" },
  { value: "custom",     label: "Custom",       description: "Pick exactly which tools to allow" },
]

function presetMeta(value: string) {
  return PRESETS.find((p) => p.value === value) || PRESETS[1]
}

// Per-toolkit ACL editor. Each toolkit is a collapsible row; expanding
// reveals the preset picker and (when 'custom') the per-tool checklist.
// Save batches all changes in one PATCH.
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

  function toggleOpen(slug: string) {
    const next = openSlug === slug ? null : slug
    setOpenSlug(next)
    if (next) loadTools(slug)
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
        if (set.has(toolName)) set.delete(toolName)
        else set.add(toolName)
        // Toggling individual tools implies custom mode
        return { ...p, allowed_tools: Array.from(set), preset: "custom" }
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
        <div>
          <Overline>Per-tool permissions</Overline>
          <p className="text-xs text-muted-foreground mt-1">
            Click a service to change what this agent is allowed to do with it.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </button>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {policies.map((p) => {
          const isOpen = openSlug === p.toolkit_slug
          const meta = presetMeta(p.preset)
          const customCount = p.preset === "custom" ? p.allowed_tools.length : null
          return (
            <div key={p.toolkit_slug}>
              <button
                type="button"
                onClick={() => toggleOpen(p.toolkit_slug)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                    isOpen && "rotate-90",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{p.label || p.toolkit_slug}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {customCount !== null
                      ? `Custom · ${customCount} tool${customCount === 1 ? "" : "s"} allowed`
                      : meta.description}
                  </div>
                </div>
                <span className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium">
                  {meta.label}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-border bg-muted/20 px-4 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PRESETS.map((preset) => {
                      const active = p.preset === preset.value
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setPreset(p.toolkit_slug, preset.value)}
                          className={cn(
                            "rounded-md border p-3 text-left transition",
                            active
                              ? "border-foreground bg-card shadow-sm"
                              : "border-border bg-card/50 hover:bg-card",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">{preset.label}</span>
                            {active && <Check className="h-3.5 w-3.5" />}
                          </div>
                          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
                            {preset.description}
                          </p>
                        </button>
                      )
                    })}
                  </div>

                  {p.preset === "custom" && (
                    <div>
                      <div className="text-[11px] font-medium text-muted-foreground mb-2">
                        Choose which tools this agent can call
                      </div>
                      <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border border-border bg-card p-2">
                        {(tools[p.toolkit_slug] || []).map((t) => {
                          const isAllowed = p.allowed_tools.includes(t.slug)
                          return (
                            <label
                              key={t.slug}
                              className={cn(
                                "flex items-start gap-2 rounded p-2 cursor-pointer hover:bg-muted/50",
                                isAllowed && "bg-muted/30",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isAllowed}
                                onChange={() => toggleAllowed(p.toolkit_slug, t.slug)}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium truncate">{t.name || t.slug}</div>
                                {t.description && (
                                  <div className="text-[11px] text-muted-foreground line-clamp-2">
                                    {t.description}
                                  </div>
                                )}
                              </div>
                            </label>
                          )
                        })}
                        {(tools[p.toolkit_slug]?.length === 0) && (
                          <p className="text-[11px] text-muted-foreground p-2">
                            No individual tools available for this service.
                          </p>
                        )}
                        {!tools[p.toolkit_slug] && (
                          <p className="text-[11px] text-muted-foreground p-2">Loading tools…</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
