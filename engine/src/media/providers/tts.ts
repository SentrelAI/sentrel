import { logger } from "../../logger.js";
import { CircuitBreaker } from "../../lib/circuit-breaker.js";

// One breaker per provider — a slow ElevenLabs shouldn't trip the OpenAI probe.
const ttsOptions = { failThreshold: 3, cooldownMs: 30_000, timeoutMs: 20_000 };
const openaiTtsBreaker = new CircuitBreaker("openai-tts", ttsOptions);
const elevenlabsTtsBreaker = new CircuitBreaker("elevenlabs-tts", ttsOptions);
const cartesiaTtsBreaker = new CircuitBreaker("cartesia-tts", ttsOptions);

// Text-to-speech provider abstraction. Default: OpenAI TTS ($0.015/1K chars).
// Switch via TTS_PROVIDER env var: "openai" | "elevenlabs" | "cartesia"

export async function synthesize(
  text: string,
  voice?: string,
): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const provider = process.env.TTS_PROVIDER || "openai";

  switch (provider) {
    case "elevenlabs":
      return synthesizeElevenLabs(text, voice);
    case "cartesia":
      return synthesizeCartesia(text, voice);
    default:
      return synthesizeOpenAI(text, voice);
  }
}

// ── OpenAI TTS ($0.015/1K chars, 6 voices, good quality) ──

async function synthesizeOpenAI(text: string, voice?: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("TTS: OPENAI_API_KEY not set");

  const arrayBuffer = await openaiTtsBreaker.call(async (signal) => {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || "tts-1",
        input: text,
        voice: voice || process.env.TTS_VOICE || "alloy",
        response_format: "opus",
      }),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error(`OpenAI TTS error: ${res.status} ${err}`);
      throw new Error(`OpenAI TTS failed: ${res.status}`);
    }
    return await res.arrayBuffer();
  });
  logger.info(`OpenAI TTS: synthesized ${text.length} chars`);
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: "audio/opus",
    filename: `voice-${Date.now()}.opus`,
  };
}

// ── ElevenLabs ($0.18/1K chars, highest quality, voice cloning) ──

async function synthesizeElevenLabs(text: string, voice?: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("TTS: ELEVENLABS_API_KEY not set");

  const voiceId = voice || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel

  const arrayBuffer = await elevenlabsTtsBreaker.call(async (signal) => {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL || "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal,
      },
    );
    if (!res.ok) {
      const err = await res.text();
      logger.error(`ElevenLabs TTS error: ${res.status} ${err}`);
      throw new Error(`ElevenLabs TTS failed: ${res.status}`);
    }
    return await res.arrayBuffer();
  });
  logger.info(`ElevenLabs TTS: synthesized ${text.length} chars`);
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: "audio/mpeg",
    filename: `voice-${Date.now()}.mp3`,
  };
}

// ── Cartesia (fast, real-time, conversational) ──

async function synthesizeCartesia(text: string, voice?: string) {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error("TTS: CARTESIA_API_KEY not set");

  const voiceId = voice || process.env.CARTESIA_VOICE_ID || "a0e99841-438c-4a64-b679-ae501e7d6091";

  const arrayBuffer = await cartesiaTtsBreaker.call(async (signal) => {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: text,
        model_id: "sonic-english",
        voice: { mode: "id", id: voiceId },
        output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
      }),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error(`Cartesia TTS error: ${res.status} ${err}`);
      throw new Error(`Cartesia TTS failed: ${res.status}`);
    }
    return await res.arrayBuffer();
  });
  logger.info(`Cartesia TTS: synthesized ${text.length} chars`);
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: "audio/mpeg",
    filename: `voice-${Date.now()}.mp3`,
  };
}
