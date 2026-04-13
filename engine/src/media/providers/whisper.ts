import { logger } from "../../logger.js";

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

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error(`Whisper API error: ${res.status} ${errBody}`);
    throw new Error(`Whisper transcription failed: ${res.status}`);
  }

  const data = (await res.json()) as { text: string };
  logger.info(`Whisper: transcribed ${filename} (${data.text.length} chars)`);
  return data.text;
}
