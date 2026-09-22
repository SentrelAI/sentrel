import { useCallback, useEffect, useRef, useState } from "react"

// Live model catalog, served by /model_catalog from catalog_models — synced
// daily from models.dev (ModelsDev::CatalogSync). `groups` is the curated
// shortlist a picker opens on; `all` is every model we know about, which is
// what search filters over.
export type CatalogOption = {
  provider: string
  model_id: string
  label: string
  hint?: string
  // Present on `all` rows only — search shows these, groups don't need them.
  context?: number | null
  reasoning?: boolean
  tool_call?: boolean
  release_date?: string | null
}

export type CatalogGroup = { group: string; options: CatalogOption[] }

export type ModelCatalog = {
  groups: CatalogGroup[]
  all: CatalogOption[]
  synced_at?: string | null
  default_model?: string
}

// The full catalog is a few hundred models — fetched on demand (first time a
// picker opens) rather than shipped as a prop on every page, and cached for
// the life of the tab.
let cache: ModelCatalog | null = null
let inflight: Promise<ModelCatalog | null> | null = null

export async function fetchModelCatalog(): Promise<ModelCatalog | null> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch("/model_catalog", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ModelCatalog | null) => {
        if (data?.groups) cache = data
        return cache
      })
      .catch(() => null)
      .finally(() => { inflight = null })
  }
  return inflight
}

// `enabled` defers the fetch until something actually needs the list (a
// dropdown opening), so page load doesn't pay for it.
export function useModelCatalog(enabled = true): { catalog: ModelCatalog | null; loading: boolean } {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(cache)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!enabled || catalog) return
    setLoading(true)
    fetchModelCatalog().then((data) => {
      if (!mounted.current) return
      setCatalog(data)
      setLoading(false)
    })
  }, [enabled, catalog])

  return { catalog, loading }
}

// Case-insensitive match over the things a person actually types: the label,
// the id, and the vendor prefix.
export function filterModels(models: CatalogOption[], query: string): CatalogOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  const terms = q.split(/\s+/)
  return models.filter((m) => {
    const haystack = `${m.label} ${m.model_id} ${m.provider}`.toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })
}

export function useModelOptionsFor(provider: string): Array<{ value: string; label: string; hint?: string }> {
  const { catalog } = useModelCatalog()
  return useCallback(() => {
    const live = catalog?.all.filter((m) => m.provider === provider)
    if (live && live.length > 0) {
      return live.map((m) => ({ value: m.model_id, label: m.label, hint: m.hint }))
    }
    return MODELS_BY_PROVIDER[provider] || []
  }, [catalog, provider])()
}

// Fallback used before the catalog loads (and if /model_catalog is
// unreachable). Kept short on purpose — the live list is the real one.
export const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-opus-5",    label: "Claude Opus 5",    hint: "newest flagship — strongest overall" },
    { value: "claude-sonnet-5",  label: "Claude Sonnet 5",  hint: "recommended default — fast + smart" },
    { value: "claude-fable-5",   label: "Claude Fable 5",   hint: "long-form + creative" },
    { value: "claude-opus-4-8",  label: "Claude Opus 4.8",  hint: "previous Opus" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fastest + cheapest, good for background tasks" },
  ],
  openrouter: [
    { value: "openai/gpt-5.6-terra-pro", label: "GPT-5.6 Terra Pro", hint: "OpenAI flagship" },
    { value: "google/gemini-3.6-flash",  label: "Gemini 3.6 Flash",  hint: "fast + huge context" },
    { value: "moonshotai/kimi-k3",       label: "Kimi K3",           hint: "top agentic tool use" },
    { value: "x-ai/grok-4.5",            label: "Grok 4.5",          hint: "xAI flagship" },
    { value: "z-ai/glm-5.2",             label: "GLM 5.2 (Z.ai)",    hint: "strong agentic coding" },
    { value: "qwen/qwen3.7-plus",        label: "Qwen3.7 Plus",      hint: "open reasoning generalist" },
    { value: "minimax/minimax-m3",       label: "MiniMax M3",        hint: "long-context reasoning" },
    { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro",   hint: "strong reasoning, cheap" },
  ],
}
