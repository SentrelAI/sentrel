import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Brain, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { router } from "@inertiajs/react"

// Providers whose models are unusable without a BYO key in /settings/credentials.
// "anthropic" stays out of this gate: the platform ships an org-level fallback
// ANTHROPIC_API_KEY so Claude-direct models work even without a user key.
const KEY_REQUIRED_PROVIDERS = new Set(["openrouter"])

// Curated model list — same shape as the picker on /agents/new. Grouped
// by provider so users see at a glance what each model is. OpenRouter
// entries include the high-signal "agentic" models (Kimi, MiniMax) up
// top because they're the point of this surface.
const MODELS: Array<{
  group: string
  options: Array<{ provider: string; model_id: string; label: string; hint?: string }>
}> = [
  {
    group: "Anthropic (direct)",
    options: [
      { provider: "anthropic", model_id: "claude-opus-4-8",           label: "Claude Opus 4.8",   hint: "newest Opus — strongest reasoning" },
      { provider: "anthropic", model_id: "claude-opus-4-7",           label: "Claude Opus 4.7",   hint: "previous Opus, still excellent" },
      { provider: "anthropic", model_id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", hint: "recommended default — fast + smart" },
      { provider: "anthropic", model_id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  hint: "fastest + cheapest" },
    ],
  },
  // Subscription auth (anthropic_account / openai_account) — temporarily
  // hidden from the picker. Backend routing in agent_provisioner stays in
  // place; flip these back on once the OAuth flow is registered.
  {
    // Non-Anthropic OR models resolve via ANTHROPIC_DEFAULT_*_MODEL env vars
    // (set by Rails agent_provisioner) — the engine doesn't pass the slug to
    // the SDK directly, so client-side validation is bypassed.
    group: "OpenRouter — specialty",
    options: [
      { provider: "openrouter", model_id: "moonshotai/kimi-k2.6",       label: "Kimi K2.6 (Moonshot)", hint: "top agentic tool use" },
      { provider: "openrouter", model_id: "minimax/minimax-m2.7",       label: "MiniMax M2.7",         hint: "long-context reasoning" },
      { provider: "openrouter", model_id: "minimax/minimax-m2.5",       label: "MiniMax M2.5",         hint: "cheaper MiniMax" },
      { provider: "openrouter", model_id: "deepseek/deepseek-v4-pro",   label: "DeepSeek V4 Pro",      hint: "strong reasoning" },
      { provider: "openrouter", model_id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash",    hint: "cheap + fast" },
      { provider: "openrouter", model_id: "qwen/qwen3-max-thinking",    label: "Qwen 3 Max (thinking)", hint: "open reasoning generalist" },
    ],
  },
  {
    group: "OpenRouter — frontier",
    options: [
      { provider: "openrouter", model_id: "anthropic/claude-opus-4-7",            label: "Claude Opus 4.7 (via OR)" },
      { provider: "openrouter", model_id: "anthropic/claude-sonnet-4-6",          label: "Claude Sonnet 4.6 (via OR)" },
      { provider: "openrouter", model_id: "openai/gpt-5.5-pro",                   label: "GPT-5.5 Pro",       hint: "OpenAI flagship" },
      { provider: "openrouter", model_id: "openai/gpt-5.4-mini",                  label: "GPT-5.4 mini",      hint: "cheap OpenAI" },
      { provider: "openrouter", model_id: "google/gemini-3.1-pro-preview",        label: "Gemini 3.1 Pro",    hint: "huge context" },
      { provider: "openrouter", model_id: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite", hint: "cheap + fast Google" },
      { provider: "openrouter", model_id: "x-ai/grok-4.20",                       label: "Grok 4.20",         hint: "xAI flagship" },
    ],
  },
]

interface Props {
  agentId: number
  currentProvider?: string | null
  currentModelId?: string | null
  // When true, shows the "via your Claude subscription" group at the top.
  // Set by the agent edit page only when the org has an active anthropic
  // OauthCredential — otherwise the option would 401 the moment it ran.
  anthropicAccountConnected?: boolean
  // LLM providers (e.g. ["openrouter", "openai"]) the org has BYO keys
  // stored for. Used to grey out rows whose key is missing — without a key,
  // the agent would 401 the moment it picked the model up.
  availableLlmProviders?: string[]
}

export function AgentModelPicker({ agentId, currentProvider, currentModelId, anthropicAccountConnected, availableLlmProviders = [] }: Props) {
  const [busy, setBusy] = useState(false)

  const subscriptionGroup = anthropicAccountConnected
    ? [{
        group: "Your Claude subscription",
        options: [
          { provider: "anthropic_account", model_id: "claude-opus-4-7",           label: "Claude Opus 4.7",   hint: "via your Pro/Max subscription" },
          { provider: "anthropic_account", model_id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", hint: "via your Pro/Max subscription" },
          { provider: "anthropic_account", model_id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  hint: "via your Pro/Max subscription" },
        ],
      }]
    : []
  const groupedModels = [...subscriptionGroup, ...MODELS]

  const apply = async (provider: string, model_id: string) => {
    if (provider === currentProvider && model_id === currentModelId) return
    setBusy(true)
    const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
    try {
      const res = await fetch(`/agents/${agentId}/ai_config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, Accept: "application/json" },
        body: JSON.stringify({ ai_config: { provider, model_id } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`Model → ${model_id}`)
      // Inertia reload so the agent's top-bar meta + props refresh.
      router.reload({ only: ["agent"] })
    } catch (err) {
      toast.error(`Model change failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const currentLabel = (() => {
    const known = groupedModels.flatMap((g) => g.options).find(
      (m) => m.provider === currentProvider && m.model_id === currentModelId,
    )
    if (known) return known.label
    if (!currentModelId) return "model"
    // Prettify legacy/custom ids: "claude-sonnet-4-20250514" → "Sonnet 4"
    return currentModelId
      .split("/")
      .pop()!
      .replace(/^claude-/, "")
      .replace(/-\d{8}$/, "") // strip trailing date stamp
      .replace(/(^|\s|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase())
  })()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 font-normal hover:bg-muted hover:text-foreground"
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Brain className="size-3.5" />}
          <span className="text-muted-foreground">Brain:</span>
          <span className="font-medium">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {groupedModels.map((group, i) => (
          <div key={group.group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
            {group.options.map((m) => {
              const isCurrent = m.provider === currentProvider && m.model_id === currentModelId
              const keyMissing = KEY_REQUIRED_PROVIDERS.has(m.provider) && !availableLlmProviders.includes(m.provider)
              return (
                <DropdownMenuItem
                  key={`${m.provider}-${m.model_id}`}
                  onSelect={() => {
                    if (keyMissing) {
                      router.visit("/settings/credentials")
                      return
                    }
                    apply(m.provider, m.model_id)
                  }}
                  className={`focus:bg-muted focus:text-foreground flex flex-col items-start gap-0.5 py-2 ${keyMissing ? "opacity-50" : ""}`}
                >
                  <div className="flex w-full items-center gap-2">
                    {isCurrent ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    <span className="font-medium">{m.label}</span>
                  </div>
                  {keyMissing ? (
                    <span className="pl-5.5 text-xs text-muted-foreground italic">
                      Go to settings to set up your API key
                    </span>
                  ) : m.hint ? (
                    <span className="text-muted-foreground pl-5.5 text-xs">{m.hint}</span>
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
