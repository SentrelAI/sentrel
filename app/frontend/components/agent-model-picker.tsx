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
import { Sparkles, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { router } from "@inertiajs/react"

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
      { provider: "anthropic", model_id: "claude-opus-4-7",           label: "Claude Opus 4.7", hint: "strongest reasoning" },
      { provider: "anthropic", model_id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", hint: "recommended default" },
      { provider: "anthropic", model_id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest + cheapest" },
    ],
  },
  {
    group: "OpenRouter — specialty",
    options: [
      { provider: "openrouter", model_id: "moonshotai/kimi-k2",   label: "Kimi K2 (Moonshot)", hint: "strong agentic tool use" },
      { provider: "openrouter", model_id: "minimax/minimax-m1",   label: "MiniMax M1",         hint: "long-context reasoning" },
      { provider: "openrouter", model_id: "minimax/minimax-01",   label: "MiniMax Text-01",    hint: "1M context window" },
      { provider: "openrouter", model_id: "deepseek/deepseek-chat", label: "DeepSeek V3",      hint: "cheap high-quality" },
    ],
  },
  {
    group: "OpenRouter — mainline (via OR)",
    options: [
      { provider: "openrouter", model_id: "anthropic/claude-opus-4-7",   label: "Claude Opus 4.7" },
      { provider: "openrouter", model_id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { provider: "openrouter", model_id: "openai/gpt-4o",               label: "GPT-4o" },
    ],
  },
]

interface Props {
  agentId: number
  currentProvider?: string | null
  currentModelId?: string | null
}

export function AgentModelPicker({ agentId, currentProvider, currentModelId }: Props) {
  const [busy, setBusy] = useState(false)

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

  const currentLabel =
    MODELS.flatMap((g) => g.options).find(
      (m) => m.provider === currentProvider && m.model_id === currentModelId,
    )?.label ??
    (currentModelId ? currentModelId.split("/").pop()?.replace(/^claude-/, "") : "model")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 font-normal" disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          <span className="text-muted-foreground">Model:</span>
          <span className="font-medium">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {MODELS.map((group, i) => (
          <div key={group.group}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.group}</DropdownMenuLabel>
            {group.options.map((m) => {
              const isCurrent = m.provider === currentProvider && m.model_id === currentModelId
              return (
                <DropdownMenuItem
                  key={`${m.provider}-${m.model_id}`}
                  onSelect={() => apply(m.provider, m.model_id)}
                  className="focus:bg-muted focus:text-foreground flex flex-col items-start gap-0.5 py-2"
                >
                  <div className="flex w-full items-center gap-2">
                    {isCurrent ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    <span className="font-medium">{m.label}</span>
                  </div>
                  {m.hint && (
                    <span className="text-muted-foreground pl-5.5 text-xs">{m.hint}</span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
