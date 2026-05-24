// Replicate image generation — flux-1-schnell by default (~$0.003/img,
// 1-2s). Replicate's predictions API is async — we poll briefly for
// completion. Most flux calls finish in <5s; we cap polling at 60s.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const API_BASE = "https://api.replicate.com/v1";
const DEFAULT_MODEL = "black-forest-labs/flux-schnell";

async function getKey(agentId: number): Promise<{ key: string; source: string | null } | null> {
  const cred = await fetchSecret({ agentId, provider: "replicate", kind: "generic" });
  if (!cred) return null;
  return { key: cred.fields?.api_key || cred.value, source: cred.source ?? null };
}

export const ReplicateProvider = {
  name: "replicate" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const auth = await getKey(agentId);
    if (!auth) throw new Error("replicate: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);

    const res = await fetch(`${API_BASE}/models/${model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.key}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          prompt: input.prompt,
          num_outputs: n,
          aspect_ratio: input.aspect_ratio || "1:1",
          output_format: "png",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`replicate predictions failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json() as {
      id: string;
      status: string;
      output?: string[] | string;
      error?: string;
      urls?: { get: string };
    };

    let final = data;
    let pollAttempts = 0;
    while (final.status !== "succeeded" && final.status !== "failed" && pollAttempts < 30) {
      await new Promise((r) => setTimeout(r, 2000));
      pollAttempts++;
      const poll = await fetch(final.urls?.get || `${API_BASE}/predictions/${data.id}`, {
        headers: { Authorization: `Bearer ${auth.key}` },
      });
      if (!poll.ok) break;
      final = await poll.json() as typeof data;
    }

    if (final.status !== "succeeded") {
      throw new Error(`replicate prediction ${final.status}: ${final.error || "unknown"}`);
    }
    const urls = Array.isArray(final.output) ? final.output : (final.output ? [final.output] : []);
    if (urls.length === 0) throw new Error("replicate returned no images");

    logger.info(`replicate generated ${urls.length} image(s) on ${model} (source: ${auth.source})`);
    return downloadAll(urls, model);
  },
};

export async function downloadAll(urls: string[], model: string): Promise<GenerateImageOutput> {
  const dir = path.join(config.dataDir, "workspace", "generated");
  await fs.mkdir(dir, { recursive: true });
  const ts = Date.now();
  const files = await Promise.all(urls.map(async (url, idx) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${url} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const filePath = path.join(dir, `image-${ts}-${idx + 1}.png`);
    await fs.writeFile(filePath, buf);
    return { filePath, bytes: buf.byteLength, model };
  }));
  return { files };
}
