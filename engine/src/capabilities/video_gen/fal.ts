// fal.ai as a video provider too — they host Wan, Kling, Hailuo, etc.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const DEFAULT_MODEL = "fal-ai/wan-25-preview/text-to-video/fast";

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
    const model = input.model || DEFAULT_MODEL;

    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || "16:9",
        duration: input.duration,
      }),
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
