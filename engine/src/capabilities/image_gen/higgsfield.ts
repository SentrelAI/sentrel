// Higgsfield "Soul" text-to-image. Contract VERIFIED against the live API
// (2026-06): submit + poll paths, headers, body shape and the
// width_and_height enum were all confirmed with a real key.
//
//   auth   : two headers — "hf-api-key": <KEY_ID>, "hf-secret": <KEY_SECRET>
//   submit : POST https://platform.higgsfield.ai/v1/text2image/soul
//              { "params": { "prompt": "...", "width_and_height": "<enum>" } }
//   poll   : GET  /v1/job-sets/{id}  → status QUEUED|IN_PROGRESS|COMPLETED|
//              NSFW|FAILED|CANCELED (UPPERCASE); image at images[0].url /
//              jobs[].results.raw.url
//
// width_and_height is a fixed pixel-size enum, NOT a ratio. Mapped from the
// caller's aspect_ratio below.

import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import { downloadAll } from "./replicate.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";

// Verified valid enum values; map common ratios to the closest supported size.
function widthAndHeight(ar?: string): string {
  switch (ar) {
    case "9:16": return "1152x2048";
    case "16:9": return "2048x1152";
    case "4:5":
    case "3:4":  return "1536x2048";
    case "1:1":
    default:     return "1536x1536";
  }
}

// Credential value is "KEY_ID:KEY_SECRET" (or split fields key_id/key_secret).
async function getAuth(agentId: number): Promise<{ id: string; secret: string } | null> {
  const cred = await fetchSecret({ agentId, provider: "higgsfield", kind: "generic" });
  if (!cred) return null;
  if (cred.fields?.key_id && cred.fields?.key_secret) {
    return { id: cred.fields.key_id, secret: cred.fields.key_secret };
  }
  const raw = cred.fields?.api_key || cred.value || "";
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return { id: raw.slice(0, idx), secret: raw.slice(idx + 1) };
}

// Pull every image URL out of a job-set poll response, tolerating the few
// shapes the API/SDK use (top-level images, or per-job results).
function imageUrls(data: any): string[] {
  const out: string[] = [];
  const push = (u: unknown) => { if (typeof u === "string" && u) out.push(u); };
  push(data?.images?.[0]?.url);
  for (const j of (data?.jobs || [])) {
    push(j?.results?.raw?.url);
    push(j?.results?.min?.url);
    push(j?.image?.url);
    for (const im of (j?.images || [])) push(im?.url);
  }
  return [...new Set(out)];
}

function jobSetStatus(data: any): string {
  return String(data?.status || data?.jobs?.[0]?.status || "").toUpperCase();
}

export const HiggsfieldImageProvider = {
  name: "higgsfield" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getAuth(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const auth = await getAuth(agentId);
    if (!auth) throw new Error("higgsfield: no credential resolved");
    const headers = { "hf-api-key": auth.id, "hf-secret": auth.secret, "Content-Type": "application/json" };

    const res = await fetch(`${BASE}/v1/text2image/soul`, {
      method: "POST",
      headers,
      body: JSON.stringify({ params: { prompt: input.prompt, width_and_height: widthAndHeight(input.aspect_ratio) } }),
    });
    if (!res.ok) throw new Error(`higgsfield submit failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const submit = await res.json() as { id?: string; job_set_id?: string };
    const jobSetId = submit.id || submit.job_set_id;
    if (!jobSetId) throw new Error(`higgsfield: no job-set id in submit response: ${JSON.stringify(submit).slice(0, 200)}`);

    let urls: string[] = [];
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`${BASE}/v1/job-sets/${jobSetId}`, { headers });
      if (!poll.ok) continue;
      const data = await poll.json();
      const status = jobSetStatus(data);
      urls = imageUrls(data);
      if (urls.length > 0) break;
      if (status === "FAILED" || status === "CANCELED") throw new Error(`higgsfield job ${status}`);
      if (status === "NSFW") throw new Error("higgsfield: generation flagged nsfw");
    }
    if (urls.length === 0) throw new Error("higgsfield: timed out / no image url");

    logger.info(`higgsfield(soul) generated ${urls.length} image(s)`);
    return downloadAll(urls, "higgsfield-soul");
  },
};
