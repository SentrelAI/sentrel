// fal.ai video — the composable creative engine. One provider, several
// primitives the agent chains to build ANY ad:
//
//   • scene video  (Kling t2v / i2v)         — cinematic b-roll
//   • pre-made avatar (veed text-to-video)    — a stock creator speaks a script
//   • CUSTOM talking avatar (TTS + lip-sync)  — make ANY face you generate
//        (a doctor, a nurse, a patient) speak a script, lip-synced. This is
//        what makes "doctor UGC" possible without us hard-coding a doctor:
//        the agent generates the person, hands us the image + the script,
//        and we voice it (fal ElevenLabs) and lip-sync it (Kling AI Avatar).
//
// Contracts all VERIFIED live (2026-06) against the org's real fal key:
//   auth   : Authorization: Key <FAL_KEY>
//   submit : POST https://queue.fal.run/<model> { ...inputs }
//              → { status_url, response_url, request_id, status:"IN_QUEUE" }
//   poll   : GET status_url   → { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
//   result : GET response_url → { video:{url} }  (or { audio:{url} } for TTS)
//
// Why TTS runs HERE (not via the tts capability): the lip-sync model fetches
// the audio by URL, and it can't reach our /api/blobs URLs (Cloudflare +
// no content-length). fal's own ElevenLabs TTS returns a fal.media URL that
// fal CAN fetch — so the audio never leaves fal's network. Images, which the
// lip-sync model also can't fetch from us, are inlined as base64 data URIs.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const QUEUE = "https://queue.fal.run";
// Kling 2.1 standard — strong quality at a sane price. Override per-call via
// input.model, or globally via FAL_VIDEO_I2V_MODEL / FAL_VIDEO_T2V_MODEL.
const DEFAULT_I2V = process.env.FAL_VIDEO_I2V_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video";
const DEFAULT_T2V = process.env.FAL_VIDEO_T2V_MODEL || "fal-ai/kling-video/v2.1/standard/text-to-video";
// Pre-made UGC creator: a script → a stock person delivering it. Fixed
// library of generic creators (no custom face, no doctors).
const DEFAULT_AVATAR = process.env.FAL_AVATAR_MODEL || "veed/avatars/text-to-video";
// CUSTOM talking avatar: a face image + an audio track → that exact person,
// lip-synced. This is how the agent makes a generated doctor talk.
//
// OmniHuman (ByteDance) is the default: it preserves real skin texture (no
// waxy "AI-avatar" sheen that the Kling avatar tiers add). Its one weakness
// is that it animates the whole body and can mangle hands/arms — the ugc-ads
// skill counters this by mandating TIGHT head-and-shoulders source framing
// (no arms in the shot) + a self-review pass. Swap via FAL_LIPSYNC_MODEL
// (e.g. veed/fabric-1.0 for a cheaper, pose-stable alternative).
const DEFAULT_LIPSYNC = process.env.FAL_LIPSYNC_MODEL || "fal-ai/bytedance/omnihuman";
// Voice the script. fal-hosted ElevenLabs → returns a fal.media audio URL
// the lip-sync model can fetch (our own blob URLs are unreachable to fal).
const TTS_MODEL = process.env.FAL_TTS_MODEL || "fal-ai/elevenlabs/tts/multilingual-v2";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "fal", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

// fal's external fetcher can't pull our /api/blobs URLs (Cloudflare + no
// content-length). So we INLINE any source image as a base64 data URI rather
// than handing fal a URL. Handles a local workspace path (read) or any
// http(s) URL the engine can reach (fetch), incl. our own blob URLs.
async function toDataUri(image: string): Promise<string | null> {
  if (image.startsWith("data:")) return image;
  let bytes: Buffer;
  if (/^https?:\/\//.test(image)) {
    const r = await fetch(image);
    if (!r.ok) return null;
    bytes = Buffer.from(await r.arrayBuffer());
  } else {
    try { bytes = await fs.readFile(image); } catch { return null; }
  }
  const lower = image.toLowerCase();
  const ct = lower.includes(".jpg") || lower.includes(".jpeg") ? "image/jpeg"
    : lower.includes(".webp") ? "image/webp" : "image/png";
  return `data:${ct};base64,${bytes.toString("base64")}`;
}

// Submit a job to fal's queue and poll to completion. Returns the result
// JSON (shape depends on the model: { video:{url} } or { audio:{url} }).
// maxPolls × 3s — Kling renders run 1–4 min; TTS is seconds.
async function submitAndPoll(
  model: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  maxPolls = 150,
): Promise<Record<string, unknown>> {
  const submitRes = await fetch(`${QUEUE}/${model}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!submitRes.ok) throw new Error(`fal ${model} submit failed: ${submitRes.status} ${(await submitRes.text()).slice(0, 200)}`);
  const submit = await submitRes.json() as { status_url?: string; response_url?: string };
  if (!submit.status_url || !submit.response_url) throw new Error(`fal ${model}: no status/response url: ${JSON.stringify(submit).slice(0, 200)}`);

  let done = false;
  for (let i = 0; i < maxPolls && !done; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(submit.status_url, { headers });
    if (!st.ok) continue;
    const status = String(((await st.json()) as { status?: string }).status || "").toUpperCase();
    if (status === "COMPLETED") done = true;
    else if (status === "ERROR" || status === "FAILED") throw new Error(`fal ${model} job ${status}`);
  }
  if (!done) throw new Error(`fal ${model}: timed out`);

  const out = await fetch(submit.response_url, { headers });
  if (!out.ok) throw new Error(`fal ${model} result fetch failed: ${out.status}`);
  return await out.json() as Record<string, unknown>;
}

// Voice a script on fal and return the resulting fal.media audio URL.
async function falTts(text: string, voice: string | undefined, headers: Record<string, string>): Promise<string> {
  const body: Record<string, unknown> = { text };
  if (voice) body.voice = voice;
  const result = await submitAndPoll(TTS_MODEL, body, headers, 40);
  const url = (result.audio as { url?: string } | undefined)?.url;
  if (!url) throw new Error(`fal TTS: no audio url in result: ${JSON.stringify(result).slice(0, 200)}`);
  return url;
}

export const FalVideoProvider = {
  name: "fal" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("fal video: no credential resolved");
    const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

    let model: string;
    const body: Record<string, unknown> = {};
    let mode = "scene";

    if (input.avatar && input.image) {
      // CUSTOM talking avatar — make THIS face speak the script. Voice the
      // prompt on fal (audio stays a fetchable fal.media URL), inline the
      // face as a data URI, then lip-sync. prompt = the verbatim script.
      const imageData = await toDataUri(input.image);
      if (!imageData) throw new Error(`fal lipsync: couldn't read face image ${input.image}`);
      const audioUrl = await falTts(input.prompt, input.voice, headers);
      model = input.model || DEFAULT_LIPSYNC;
      body.image_url = imageData;
      body.audio_url = audioUrl;
      mode = "custom-avatar";
    } else if (input.avatar) {
      // Pre-made UGC creator (veed). prompt = the verbatim script.
      model = input.model || DEFAULT_AVATAR;
      body.text = input.prompt;
      body.avatar_id = input.avatar;
      mode = "stock-avatar";
    } else {
      // Scene video (Kling). i2v when a source image is given — inline it as
      // a data URI so fal never has to fetch a URL. Kling derives the ratio
      // from the image; t2v needs an explicit aspect_ratio.
      const imageData = input.image ? await toDataUri(input.image) : null;
      if (input.image && !imageData) throw new Error(`fal kling: couldn't read source image ${input.image}`);
      model = input.model || (imageData ? DEFAULT_I2V : DEFAULT_T2V);
      body.prompt = input.prompt;
      body.duration = (input.duration && input.duration >= 10) ? "10" : "5";
      if (imageData) body.image_url = imageData;
      else body.aspect_ratio = input.aspect_ratio || "9:16";
    }

    const result = await submitAndPoll(model, body, headers);
    const url = (result.video as { url?: string } | undefined)?.url;
    if (!url) throw new Error(`fal ${model}: no video url in result: ${JSON.stringify(result).slice(0, 200)}`);

    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`fal kling download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    logger.info(`fal generated video on ${model} (${mode})`);
    return { filePath, bytes: buf.byteLength, model };
  },
};
