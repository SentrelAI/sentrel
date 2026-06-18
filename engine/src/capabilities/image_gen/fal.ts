// fal.ai image generation — fast cold-start, comparable to Replicate.
//
// Default model: fal-ai/flux/schnell (cheap, fast). For PHOTOREAL people —
// UGC creator portraits, anything that becomes a talking avatar — pass
// model: "fal-ai/flux-pro/v1.1-ultra" (verified: produces a believable
// phone-selfie of a doctor; schnell does not). The pro/ultra family takes
// an `aspect_ratio` string; the flux/schnell|dev family takes an
// `image_size` enum — we send whichever the chosen model expects.

import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import { downloadAll } from "./replicate.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const DEFAULT_MODEL = "fal-ai/flux/schnell";

// flux image_size enum keyed by aspect-ratio shorthand.
const SIZE_BY_ASPECT: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
};

// flux-pro/ultra + nano-banana / gemini image models speak aspect_ratio;
// flux schnell/dev speak the image_size enum.
function sizeFields(model: string, input: GenerateImageInput): Record<string, unknown> {
  if (/flux-pro|ultra|nano-banana|gemini/.test(model)) {
    return { aspect_ratio: input.aspect_ratio || "1:1" };
  }
  const mapped = input.aspect_ratio ? SIZE_BY_ASPECT[input.aspect_ratio] : undefined;
  return { image_size: input.size || mapped || "square_hd" };
}

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
        ...sizeFields(model, input),
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
