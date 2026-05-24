// Runway Gen-3 / Gen-4 — best quality at higher cost. Async API.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const API_BASE = "https://api.dev.runwayml.com/v1";
const DEFAULT_MODEL = "gen4_turbo";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "runway", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const RunwayProvider = {
  name: "runway" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("runway: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const body: Record<string, unknown> = {
      promptText: input.prompt,
      ratio: input.aspect_ratio === "9:16" ? "720:1280" : (input.aspect_ratio === "1:1" ? "960:960" : "1280:720"),
      model,
      duration: Math.min(input.duration ?? 5, 10),
    };

    const endpoint = input.image ? "image_to_video" : "text_to_video";
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`runway create failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const job = await res.json() as { id: string };

    let task: { status: string; output?: string[]; failure?: string } = { status: "PENDING" };
    for (let i = 0; i < 180 && task.status !== "SUCCEEDED" && task.status !== "FAILED"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await fetch(`${API_BASE}/tasks/${job.id}`, {
        headers: { Authorization: `Bearer ${key}`, "X-Runway-Version": "2024-11-06" },
      });
      if (!s.ok) break;
      task = await s.json();
    }
    if (task.status !== "SUCCEEDED" || !task.output?.[0]) {
      throw new Error(`runway task ${task.status}: ${task.failure || ""}`);
    }

    const videoRes = await fetch(task.output[0]);
    if (!videoRes.ok) throw new Error(`runway download failed: ${videoRes.status}`);
    const buf = Buffer.from(await videoRes.arrayBuffer());

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    return { filePath, bytes: buf.byteLength, model };
  },
};
