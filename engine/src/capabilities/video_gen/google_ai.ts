// Google Veo (via Gemini API). Async — start operation, poll, download.
// Reuses generic:google_ai / llm_api_key:google_ai credentials.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const DEFAULT_MODEL = "veo-3.0-generate-001";

async function getKey(agentId: number): Promise<string | null> {
  let cred = await fetchSecret({ agentId, provider: "google_ai", kind: "generic" });
  if (!cred) cred = await fetchSecret({ agentId, provider: "google_ai", kind: "llm_api_key" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.fields?.value || cred.value;
}

export const GoogleAiVideoProvider = {
  name: "google_ai" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("google_ai video: no credential resolved");
    const model = input.model || DEFAULT_MODEL;

    // 1. predictLongRunning to start the generation.
    const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${encodeURIComponent(key)}`;
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: input.prompt }],
        parameters: {
          aspectRatio: input.aspect_ratio || "16:9",
          durationSeconds: Math.min(input.duration ?? 5, 8),
        },
      }),
    });
    if (!startRes.ok) throw new Error(`google_ai veo start failed: ${startRes.status} ${(await startRes.text()).slice(0, 200)}`);
    const op = await startRes.json() as { name: string };

    // 2. Poll the operation until done.
    let done = false;
    let videoUri: string | undefined;
    for (let i = 0; i < 180 && !done; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${encodeURIComponent(key)}`);
      if (!pollRes.ok) continue;
      const polled = await pollRes.json() as {
        done?: boolean;
        response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
        error?: { message?: string };
      };
      if (polled.error) throw new Error(`google_ai veo failed: ${polled.error.message}`);
      if (polled.done) {
        done = true;
        videoUri = polled.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      }
    }
    if (!videoUri) throw new Error("google_ai veo: no video uri returned");

    // 3. Download — Gemini's File URI needs the api_key on the query string.
    const downloadUrl = videoUri.includes("?") ? `${videoUri}&key=${encodeURIComponent(key)}` : `${videoUri}?alt=media&key=${encodeURIComponent(key)}`;
    const dl = await fetch(downloadUrl);
    if (!dl.ok) throw new Error(`google_ai veo download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    return { filePath, bytes: buf.byteLength, model };
  },
};
