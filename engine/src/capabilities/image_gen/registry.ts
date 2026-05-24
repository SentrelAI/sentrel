// Image generation provider registry. Preference order is
// cost-cheapest-first so `provider: "auto"` picks the cheapest vendor
// with a resolvable key:
//
//   Replicate (~$0.003/img on flux-schnell)
//     → fal.ai (~$0.003/img on flux/schnell)
//     → OpenAI (~$0.04/img on gpt-image-1, standard quality)
//     → Google AI (~$0.04/img on imagen-3)

import { ReplicateProvider } from "./replicate.js";
import { FalProvider } from "./fal.js";
import { OpenAiImageProvider } from "./openai.js";
import { GoogleAiImageProvider } from "./google_ai.js";
import { resolveCapabilities } from "../../capabilities.js";
import type { Agent } from "../../types.js";

type ImageGenProvider =
  | typeof ReplicateProvider
  | typeof FalProvider
  | typeof OpenAiImageProvider
  | typeof GoogleAiImageProvider;

const REGISTRY: ReadonlyArray<ImageGenProvider> = [
  ReplicateProvider,
  FalProvider,
  OpenAiImageProvider,
  GoogleAiImageProvider,
];

export async function getActiveImageGenProvider(agent: Agent): Promise<ImageGenProvider> {
  const cap = resolveCapabilities(agent).image_generation;
  const desired = cap.provider || "auto";

  if (desired !== "auto") {
    const explicit = REGISTRY.find((p) => p.name === desired);
    if (!explicit) throw new Error(`image_gen provider "${desired}" not registered`);
    if (!(await explicit.isAvailable(agent.id))) {
      throw new Error(`image_gen provider "${desired}" unavailable — add a credential at /settings/credentials or set PLATFORM_${desired.toUpperCase()}_KEY.`);
    }
    return explicit;
  }
  for (const p of REGISTRY) {
    if (await p.isAvailable(agent.id)) return p;
  }
  throw new Error("image_gen: no provider available — add a key for any of replicate / fal / openai / google_ai at /settings/credentials, or set PLATFORM_REPLICATE_KEY for the platform-default tier.");
}

export const IMAGE_GEN_REGISTRY = REGISTRY;
