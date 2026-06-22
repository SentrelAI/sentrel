// Mirror of the web app's model catalog (app/frontend/lib/model-catalog.ts).
export const MODELS_BY_PROVIDER: Record<
  string,
  { value: string; label: string; hint?: string }[]
> = {
  anthropic: [
    { value: "claude-fable-5", label: "Claude Fable 5", hint: "newest flagship" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "top reasoning" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended default" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fast + cheap" },
  ],
  openai: [
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
    { value: "gpt-5.5", label: "GPT-5.5" },
  ],
  google: [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { value: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
  ],
  openrouter: [
    { value: "moonshotai/kimi-k2.6", label: "Kimi K2.6", hint: "agentic tool use" },
    { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { value: "z-ai/glm-5.2", label: "GLM 5.2" },
  ],
};

export const PROVIDERS = ["anthropic", "openai", "google", "openrouter"];

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
