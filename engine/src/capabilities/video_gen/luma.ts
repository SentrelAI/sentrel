// Luma Dream Machine — fastest cold-start, ~5s clips at decent quality.
// Async API: create → poll → download.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const API_BASE = "https://api.lumalabs.ai/dream-machine/v1";
const DEFAULT_MODEL = "ray-2";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "luma", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const LumaProvider = {
  name: "luma" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("luma: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: input.aspect_ratio || "16:9",
      model,
    };
    if (input.duration && input.duration >= 9) body.duration = "9s";

    const res = await fetch(`${API_BASE}/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`luma create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const job = await res.json() as { id: string; state: string };

    // Poll up to 5 min — Luma clips usually finish in 1–2 min.
    let state: { state: string; assets?: { video?: string } } = { state: job.state };
    for (let i = 0; i < 150 && state.state !== "completed" && state.state !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(`${API_BASE}/generations/${job.id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!s.ok) break;
      state = await s.json();
    }
    if (state.state !== "completed" || !state.assets?.video) {
      throw new Error(`luma generation ${state.state}`);
    }

    const videoRes = await fetch(state.assets.video);
    if (!videoRes.ok) throw new Error(`luma video download failed: ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    logger.info(`luma generated video on ${model}: ${buf.byteLength}B`);
    return { filePath, bytes: buf.byteLength, model };
  },
};
