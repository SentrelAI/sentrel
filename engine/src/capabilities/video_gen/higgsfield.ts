// Higgsfield image-to-video / text-to-video ("DoP" cinematic motion).
// Async submit-and-poll; returns a hosted MP4 URL we download into the
// workspace as a local filePath (same contract as runway.ts / luma.ts).
//
// API shape per the official SDK (higgsfield-ai/higgsfield-js):
//   auth   : Authorization: Key <KEY_ID>:<KEY_SECRET>
//   base   : https://platform.higgsfield.ai   (override HIGGSFIELD_BASE_URL)
//   submit : POST <base>/v1/image2video/dop
//              { input: { model, prompt, input_images: [{ type, image_url }] } }
//   poll   : GET  <base>/requests/{id}/status  → { status, video: { url } }
//
// Endpoint/body are env-overridable (HIGGSFIELD_BASE_URL,
// HIGGSFIELD_I2V_PATH, HIGGSFIELD_I2V_MODEL) and need a live key to verify
// — same posture as the other gen providers, which also can't be tested
// here without a real key.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";
const SUBMIT_PATH = process.env.HIGGSFIELD_I2V_PATH || "/v1/image2video/dop";
const DEFAULT_MODEL = process.env.HIGGSFIELD_I2V_MODEL || "dop-turbo";

async function getAuth(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "higgsfield", kind: "generic" });
  if (!cred) return null;
  const id = cred.fields?.key_id;
  const secret = cred.fields?.key_secret;
  if (id && secret) return `${id}:${secret}`;
  return cred.fields?.api_key || cred.value || null;
}

export const HiggsfieldVideoProvider = {
  name: "higgsfield" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getAuth(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const auth = await getAuth(agentId);
    if (!auth) throw new Error("higgsfield: no credential resolved");

    const headers = { Authorization: `Key ${auth}`, "Content-Type": "application/json" };
    const model = input.model || DEFAULT_MODEL;
    // input.image may be a workspace path or a URL; Higgsfield wants a URL.
    const inputImages = input.image && /^https?:\/\//.test(input.image)
      ? [{ type: "image_url", image_url: input.image }]
      : [];

    const res = await fetch(`${BASE}${SUBMIT_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: { model, prompt: input.prompt, input_images: inputImages },
      }),
    });
    if (!res.ok) throw new Error(`higgsfield submit failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const submit = await res.json() as { id?: string; request_id?: string; status?: string; video?: { url: string } };

    let result: { status: string; video?: { url: string } } = {
      status: submit.status || "queued",
      video: submit.video,
    };
    const requestId = submit.request_id || submit.id;
    for (let i = 0; i < 180 && result.status !== "completed" && result.status !== "failed" && result.status !== "nsfw"; i++) {
      if (!requestId) break;
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`${BASE}/requests/${requestId}/status`, { headers });
      if (!poll.ok) break;
      result = await poll.json() as typeof result;
    }

    if (result.status === "nsfw") throw new Error("higgsfield: generation flagged nsfw");
    if (result.status !== "completed" || !result.video?.url) throw new Error(`higgsfield video ${result.status}`);

    const dl = await fetch(result.video.url);
    if (!dl.ok) throw new Error(`higgsfield download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    logger.info(`higgsfield generated video on ${model}`);
    return { filePath, bytes: buf.byteLength, model };
  },
};
