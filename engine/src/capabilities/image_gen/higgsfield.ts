// Higgsfield text-to-image (FLUX family). Async submit-and-poll API that
// returns hosted URLs; we download into the workspace like every other
// provider so the result is a local filePath the agent can share/post.
//
// API shape per the official SDK (higgsfield-ai/higgsfield-js):
//   auth   : Authorization: Key <KEY_ID>:<KEY_SECRET>
//   base   : https://platform.higgsfield.ai   (override HIGGSFIELD_BASE_URL)
//   submit : POST <base>/v1/text2image  { model, input: { prompt, aspect_ratio } }
//   poll   : GET  <base>/requests/{id}/status  → { status, images: [{ url }] }
//   status : queued | in_progress | completed | failed | nsfw
//
// The submit path / body keys are not yet verified against a live key —
// they're env-overridable (HIGGSFIELD_BASE_URL, HIGGSFIELD_T2I_PATH,
// HIGGSFIELD_T2I_MODEL) so a one-line config fixes any drift without a
// redeploy. Same "needs a live key to confirm" posture as runway.ts.

import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import { downloadAll } from "./replicate.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";
const SUBMIT_PATH = process.env.HIGGSFIELD_T2I_PATH || "/v1/text2image";
const DEFAULT_MODEL = process.env.HIGGSFIELD_T2I_MODEL || "flux-pro/kontext/max";

// Credential may be stored as the full "KEY_ID:KEY_SECRET" string (value)
// or split into fields { key_id, key_secret }.
async function getAuth(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "higgsfield", kind: "generic" });
  if (!cred) return null;
  const id = cred.fields?.key_id;
  const secret = cred.fields?.key_secret;
  if (id && secret) return `${id}:${secret}`;
  return cred.fields?.api_key || cred.value || null;
}

export const HiggsfieldImageProvider = {
  name: "higgsfield" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getAuth(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const auth = await getAuth(agentId);
    if (!auth) throw new Error("higgsfield: no credential resolved");

    const headers = { Authorization: `Key ${auth}`, "Content-Type": "application/json" };
    const res = await fetch(`${BASE}${SUBMIT_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: input.model || DEFAULT_MODEL,
        input: {
          prompt: input.prompt,
          aspect_ratio: input.aspect_ratio || "1:1",
        },
      }),
    });
    if (!res.ok) throw new Error(`higgsfield submit failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const submit = await res.json() as { id?: string; request_id?: string; status?: string; images?: Array<{ url: string }> };

    // Some endpoints return the result inline when fast; otherwise poll.
    let result: { status: string; images?: Array<{ url: string }> } = {
      status: submit.status || "queued",
      images: submit.images,
    };
    const requestId = submit.request_id || submit.id;
    for (let i = 0; i < 90 && result.status !== "completed" && result.status !== "failed" && result.status !== "nsfw"; i++) {
      if (!requestId) break;
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`${BASE}/requests/${requestId}/status`, { headers });
      if (!poll.ok) break;
      result = await poll.json() as typeof result;
    }

    if (result.status === "nsfw") throw new Error("higgsfield: generation flagged nsfw");
    if (result.status !== "completed") throw new Error(`higgsfield image ${result.status}`);
    const urls = (result.images || []).map((im) => im.url).filter(Boolean);
    if (urls.length === 0) throw new Error("higgsfield returned no images");

    logger.info(`higgsfield generated ${urls.length} image(s) on ${input.model || DEFAULT_MODEL}`);
    return downloadAll(urls, input.model || DEFAULT_MODEL);
  },
};
