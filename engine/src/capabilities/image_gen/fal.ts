// fal.ai image generation — fast cold-start, comparable to Replicate.
// Default model: fal-ai/flux/schnell.

import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import { downloadAll } from "./replicate.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const DEFAULT_MODEL = "fal-ai/flux/schnell";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "fal", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const FalProvider = {
  name: "fal" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("fal: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);

    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        num_images: n,
        image_size: input.size || "square_hd",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`fal failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { images?: Array<{ url: string }> };
    const urls = (data.images || []).map((i) => i.url);
    if (urls.length === 0) throw new Error("fal returned no images");

    logger.info(`fal generated ${urls.length} image(s) on ${model}`);
    return downloadAll(urls, model);
  },
};
