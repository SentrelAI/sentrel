// Video gen registry. Preference: Luma → fal → Runway → Google Veo
// (Luma has the fastest cold-start at decent quality, fal is cheap +
// has many model options, Runway is highest quality at the highest
// price, Veo is best fidelity when you have Google Cloud quota.)

import { LumaProvider } from "./luma.js";
import { FalVideoProvider } from "./fal.js";
import { RunwayProvider } from "./runway.js";
import { GoogleAiVideoProvider } from "./google_ai.js";
import { resolveCapabilities } from "../../capabilities.js";
import type { Agent } from "../../types.js";

type VideoGenProvider =
  | typeof LumaProvider
  | typeof FalVideoProvider
  | typeof RunwayProvider
  | typeof GoogleAiVideoProvider;

const REGISTRY: ReadonlyArray<VideoGenProvider> = [
  LumaProvider,
  FalVideoProvider,
  RunwayProvider,
  GoogleAiVideoProvider,
];

export async function getActiveVideoGenProvider(agent: Agent): Promise<VideoGenProvider> {
  const cap = resolveCapabilities(agent).video_generation;
  const desired = cap.provider || "auto";

  if (desired !== "auto") {
    const explicit = REGISTRY.find((p) => p.name === desired);
    if (!explicit) throw new Error(`video_generation provider "${desired}" not registered`);
    if (!(await explicit.isAvailable(agent.id))) {
      throw new Error(`video_generation provider "${desired}" unavailable — add a credential at /settings/credentials.`);
    }
    return explicit;
  }
  for (const p of REGISTRY) {
    if (await p.isAvailable(agent.id)) return p;
  }
  throw new Error("video_generation: no provider available — add a key for luma / fal / runway / google_ai at /settings/credentials.");
}

export const VIDEO_GEN_REGISTRY = REGISTRY;
