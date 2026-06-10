// Model picker catalog shared by the new-agent form and the bundle
// deploy wizard. One place to add a model when providers ship new ones.
export const MODELS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; hint?: string }>> = {
  anthropic: [
    { value: "claude-opus-4-7",            label: "Claude Opus 4.7",   hint: "strongest reasoning, slowest + priciest" },
    { value: "claude-opus-4-6",            label: "Claude Opus 4.6",   hint: "previous Opus, still excellent" },
    { value: "claude-sonnet-4-6",          label: "Claude Sonnet 4.6", hint: "recommended default — fast + smart" },
    { value: "claude-sonnet-4-20250514",   label: "Claude Sonnet 4",   hint: "stable earlier Sonnet" },
    { value: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  hint: "fastest + cheapest, good for background tasks" },
  ],
  openrouter: [
    { value: "moonshotai/kimi-k2.6",            label: "Kimi K2.6 (Moonshot)", hint: "top agentic tool use" },
    { value: "minimax/minimax-m2.7",            label: "MiniMax M2.7",         hint: "long-context reasoning" },
    { value: "minimax/minimax-m2.5",            label: "MiniMax M2.5",         hint: "cheaper MiniMax" },
    { value: "deepseek/deepseek-v4-pro",        label: "DeepSeek V4 Pro",      hint: "strong reasoning" },
    { value: "deepseek/deepseek-v4-flash",      label: "DeepSeek V4 Flash",    hint: "cheap + fast" },
    { value: "qwen/qwen3-max-thinking",         label: "Qwen 3 Max (thinking)", hint: "open reasoning generalist" },
    { value: "anthropic/claude-opus-4-7",       label: "Claude Opus 4.7 (via OR)" },
    { value: "anthropic/claude-sonnet-4-6",     label: "Claude Sonnet 4.6 (via OR)" },
    { value: "openai/gpt-5.5-pro",              label: "GPT-5.5 Pro (via OR)" },
    { value: "google/gemini-3.1-pro-preview",   label: "Gemini 3.1 Pro (via OR)" },
    { value: "x-ai/grok-4.20",                  label: "Grok 4.20 (via OR)" },
  ],
}
