// Session rotation policy — Hermes-style token-utilization trigger with an
// OpenClaw-style hygiene cap as a safety valve.
//
// Why this replaces the old 30-turn cap:
// Turn count is a terrible proxy for "session is full". Two short follow-ups
// shouldn't cost the same against the cap as a 50-tool delegation chain.
// We were rotating at ~15-45% of the model's actual context window because
// turns range from ~1K to ~5K tokens depending on tool output size, and the
// 30-turn ceiling was tuned for the conservative end. Hermes uses 50% of
// context as the rotation point with a safety valve at 400 messages;
// OpenClaw's proactive trigger sits around 70-80%. We pick 50% by default —
// gives enough room for the new turn's prompt + response + cache headroom.
//
// Token estimation: we read the most recent audit_log row's input_tokens
// when available (real measurement from the SDK's last call) and fall back
// to a char-based heuristic (text-length / 4) when there's no prior run.

import type { Agent } from "./types.js";

// Approximate context windows (input tokens) per provider+model. Sourced from
// each provider's published cap as of mid-2026; bump conservatively when in
// doubt — we'd rather rotate slightly early than blow up mid-turn.
const MODEL_CONTEXT_WINDOWS: Array<{ match: (provider: string, model: string) => boolean; tokens: number }> = [
  // Anthropic — direct + via OpenRouter
  { match: (p, m) => /claude-opus-4|claude-sonnet-4|claude-haiku-4/.test(m),                          tokens: 200_000 },
  { match: (p, m) => /anthropic\/claude/.test(m),                                                      tokens: 200_000 },
  // Subscription path (anthropic_account) reuses Claude direct caps
  { match: (p, m) => p === "anthropic_account",                                                        tokens: 200_000 },

  // OpenRouter — specialty
  { match: (p, m) => /moonshotai\/kimi-k2/.test(m),                                                    tokens: 256_000 },
  { match: (p, m) => /minimax\/minimax-m2/.test(m),                                                    tokens: 256_000 },
  { match: (p, m) => /deepseek\/deepseek-v4-pro/.test(m),                                              tokens: 128_000 },
  { match: (p, m) => /deepseek\/deepseek-v4-flash/.test(m),                                            tokens: 128_000 },
  { match: (p, m) => /qwen\/qwen3-max/.test(m),                                                        tokens: 256_000 },

  // OpenRouter — frontier non-Anthropic
  { match: (p, m) => /openai\/gpt-5/.test(m),                                                          tokens: 400_000 },
  { match: (p, m) => /google\/gemini-3/.test(m),                                                       tokens: 1_000_000 },
  { match: (p, m) => /x-ai\/grok-4/.test(m),                                                           tokens: 256_000 },
];

const FALLBACK_CONTEXT_TOKENS = 128_000; // safe default for unknown models

export interface RotationConfig {
  thresholdRatio: number;        // 0.50 → rotate at 50% of context window
  hardMessageLimit: number;      // 400 → safety valve, force rotate regardless
  timeGapHours: number;          // 24 → rotate if conversation idle this long
}

export const DEFAULT_ROTATION: RotationConfig = {
  thresholdRatio: Number(process.env.SESSION_THRESHOLD_RATIO || "0.50"),
  hardMessageLimit: Number(process.env.SESSION_HARD_MESSAGE_LIMIT || "400"),
  timeGapHours: Number(process.env.SESSION_TIME_GAP_HOURS || "24"),
};

export function contextWindowFor(agent: Agent): number {
  const provider = (agent.ai_config?.provider || "").toLowerCase();
  const model    = (agent.ai_config?.model_id || "").toLowerCase();
  for (const row of MODEL_CONTEXT_WINDOWS) {
    if (row.match(provider, model)) return row.tokens;
  }
  return FALLBACK_CONTEXT_TOKENS;
}

export interface ResumeDecision {
  resume: boolean;
  reason: "fresh-conversation" | "no-prior-session" | "time-gap" | "token-threshold" | "hygiene-message-cap" | "ok";
  details: { contextTokens: number; estimatedTokens: number; messageCount: number; thresholdTokens: number };
}

export interface RotationInputs {
  hasSessionId: boolean;
  lastMessageAt: string | null | undefined;
  messageCount: number;
  // Most accurate signal: the last run's actual prompt token count from
  // audit_logs.input_tokens. Includes system prompt + cached history.
  // Pass null/undefined if no prior run for this session.
  lastRunInputTokens: number | null | undefined;
  // Fallback signal: total characters across all messages in the conversation.
  // Used when lastRunInputTokens isn't available. Rough chars/4 → tokens.
  totalCharsFallback: number;
}

export function decideRotation(
  agent: Agent,
  inputs: RotationInputs,
  config: RotationConfig = DEFAULT_ROTATION,
): ResumeDecision {
  const contextTokens = contextWindowFor(agent);
  const thresholdTokens = Math.floor(contextTokens * config.thresholdRatio);

  if (!inputs.hasSessionId) {
    return mkDecision(false, "no-prior-session", { contextTokens, estimatedTokens: 0, messageCount: inputs.messageCount, thresholdTokens });
  }

  if (inputs.lastMessageAt) {
    const hoursSince = (Date.now() - new Date(inputs.lastMessageAt).getTime()) / 3_600_000;
    if (hoursSince > config.timeGapHours) {
      return mkDecision(false, "time-gap", { contextTokens, estimatedTokens: 0, messageCount: inputs.messageCount, thresholdTokens });
    }
  }

  if (inputs.messageCount > config.hardMessageLimit) {
    return mkDecision(false, "hygiene-message-cap", { contextTokens, estimatedTokens: 0, messageCount: inputs.messageCount, thresholdTokens });
  }

  const estimatedTokens = inputs.lastRunInputTokens ?? Math.ceil(inputs.totalCharsFallback / 4);
  if (estimatedTokens >= thresholdTokens) {
    return mkDecision(false, "token-threshold", { contextTokens, estimatedTokens, messageCount: inputs.messageCount, thresholdTokens });
  }

  return mkDecision(true, "ok", { contextTokens, estimatedTokens, messageCount: inputs.messageCount, thresholdTokens });
}

function mkDecision(resume: boolean, reason: ResumeDecision["reason"], details: ResumeDecision["details"]): ResumeDecision {
  return { resume, reason, details };
}
