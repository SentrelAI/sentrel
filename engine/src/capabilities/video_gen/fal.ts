// fal.ai video — Kling (top-tier image-to-video / text-to-video). Contract
// VERIFIED live (2026-06): fal's queue API returns a status_url + response_url
// we poll. Kling honors the SOURCE image's native aspect ratio (no padding /
// zoom-from-tiny like a camera-on-still model) and supports up to 10s.
//
//   auth   : Authorization: Key <FAL_KEY>
//   submit : POST https://queue.fal.run/<model>
//              { prompt, image_url (i2v), duration: "5"|"10" }
//            → { status_url, response_url, request_id, status:"IN_QUEUE" }
//   poll   : GET status_url   → { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
//   result : GET response_url → { video: { url } }

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

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "fal", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

// fal's external fetcher can't pull our /api/blobs URLs (Cloudflare + no
// content-length) — every Kling i2v job failed with "Failed to download
// the file". So we INLINE the source image as a base64 data URI instead
// of handing fal a URL. Handles a local workspace path (read) or any
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

export const FalVideoProvider = {
  name: "fal" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("fal video: no credential resolved");
    const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

    // i2v when a source image is given (Kling derives the video's aspect
    // ratio from the source image — pass a 9:16 still for a 9:16 clip).
    // Inline it as a data URI so fal never has to fetch a URL.
    const imageData = input.image ? await toDataUri(input.image) : null;
    if (input.image && !imageData) throw new Error(`fal kling: couldn't read source image ${input.image}`);
    const model = input.model || (imageData ? DEFAULT_I2V : DEFAULT_T2V);
    const duration = (input.duration && input.duration >= 10) ? "10" : "5";

    const body: Record<string, unknown> = { prompt: input.prompt, duration };
    if (imageData) {
      // image-to-video: Kling derives the ratio from the source image.
      body.image_url = imageData;
    } else {
      // text-to-video: pass the requested ratio so Kling renders native
      // 9:16 (etc.) instead of its 16:9 default — no still, no bands.
      body.aspect_ratio = input.aspect_ratio || "9:16";
    }

    const submitRes = await fetch(`${QUEUE}/${model}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!submitRes.ok) throw new Error(`fal kling submit failed: ${submitRes.status} ${(await submitRes.text()).slice(0, 200)}`);
    const submit = await submitRes.json() as { status_url?: string; response_url?: string; request_id?: string };
    if (!submit.status_url || !submit.response_url) throw new Error(`fal kling: no status/response url: ${JSON.stringify(submit).slice(0, 200)}`);

    // Poll the queue (Kling renders take 1–4 min).
    let done = false;
    for (let i = 0; i < 150 && !done; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await fetch(submit.status_url, { headers });
      if (!st.ok) continue;
      const status = String(((await st.json()) as { status?: string }).status || "").toUpperCase();
      if (status === "COMPLETED") done = true;
      else if (status === "ERROR" || status === "FAILED") throw new Error(`fal kling job ${status}`);
    }
    if (!done) throw new Error("fal kling: timed out");

    const out = await fetch(submit.response_url, { headers });
    if (!out.ok) throw new Error(`fal kling result fetch failed: ${out.status}`);
    const result = await out.json() as { video?: { url?: string } };
    const url = result.video?.url;
    if (!url) throw new Error(`fal kling: no video url in result: ${JSON.stringify(result).slice(0, 200)}`);

    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`fal kling download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    logger.info(`fal kling generated video on ${model} (${duration}s)`);
    return { filePath, bytes: buf.byteLength, model };
  },
};
