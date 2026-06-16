// fal.ai as a video provider too — they host Wan, Kling, Hailuo, etc.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

// fal model slugs (override per-call via input.model, or globally via
// FAL_VIDEO_T2V_MODEL / FAL_VIDEO_I2V_MODEL). Defaults are current Kling
// slugs; the previous "wan-25-preview" default 404'd. Image-to-video and
// text-to-video are DIFFERENT endpoints — picked by whether a source
// image was provided.
const DEFAULT_T2V = process.env.FAL_VIDEO_T2V_MODEL || "fal-ai/kling-video/v2/master/text-to-video";
const DEFAULT_I2V = process.env.FAL_VIDEO_I2V_MODEL || "fal-ai/kling-video/v2/master/image-to-video";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "fal", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const FalVideoProvider = {
  name: "fal" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("fal video: no credential resolved");

    // image-to-video needs a PUBLIC image URL (share_file produces one);
    // a local workspace path can't be fetched by fal.
    const imageUrl = input.image && /^https?:\/\//.test(input.image) ? input.image : null;
    const model = input.model || (imageUrl ? DEFAULT_I2V : DEFAULT_T2V);

    const body: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio || "16:9",
    };
    if (input.duration) body.duration = String(input.duration);
    if (imageUrl) body.image_url = imageUrl; // required by image-to-video models

    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`fal video failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { video?: { url?: string } };
    if (!data.video?.url) throw new Error("fal video: no url");

    const dl = await fetch(data.video.url);
    if (!dl.ok) throw new Error(`fal video download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    return { filePath, bytes: buf.byteLength, model };
  },
};
