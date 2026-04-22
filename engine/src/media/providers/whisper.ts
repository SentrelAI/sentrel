import { logger } from "../../logger.js";
import { CircuitBreaker } from "../../lib/circuit-breaker.js";

const whisperBreaker = new CircuitBreaker("openai-whisper", {
  failThreshold: 3,
  cooldownMs: 30_000,
  timeoutMs: 30_000, // Whisper can legitimately take 10-20s for long audio
});

// OpenAI Whisper API transcription provider ($0.006/min).
// Default provider for Sprint 2. Swap-ready with Deepgram, Soniox, or Gemini
// by implementing the same interface.
export async function transcribe(
  bytes: Buffer,
  contentType: string,
  filename: string,
  language?: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Whisper: OPENAI_API_KEY not set");
  }

  // OpenAI rejects .oga extension (WhatsApp voice notes) — rename to .ogg
  const safeFilename = filename.replace(/\.oga$/, ".ogg");

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), safeFilename);
  // gpt-4o-mini-transcribe: better quality than whisper-1, half the cost ($0.003/min)
  formData.append("model", process.env.TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  if (language) {
    formData.append("language", language);
  }

  const data = await whisperBreaker.call(async (signal) => {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      logger.error(`Whisper API error: ${res.status} ${errBody}`);
      throw new Error(`Whisper transcription failed: ${res.status}`);
    }
    return (await res.json()) as { text: string };
  });
  logger.info(`Whisper: transcribed ${filename} (${data.text.length} chars)`);
  return data.text;
}
