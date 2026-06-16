// Higgsfield "DoP" image-to-video. Contract VERIFIED against the live API
// (2026-06): the endpoint, headers, and params.input_images shape were
// confirmed with a real key (valid request → 403 "Not enough credits").
//
//   auth   : "hf-api-key": <KEY_ID>, "hf-secret": <KEY_SECRET>
//   submit : POST https://platform.higgsfield.ai/v1/image2video/dop
//              { "params": { "prompt": "...",
//                            "input_images": [{ "type": "image_url",
//                                               "image_url": "https://…" }] } }
//   poll   : GET /v1/job-sets/{id} → status UPPERCASE; video at video.url /
//              jobs[].results.raw.url
//
// input.image MUST be a public URL (the engine's share_file produces one).

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateVideoInput, GenerateVideoOutput } from "./types.js";

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://platform.higgsfield.ai";

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

function videoUrl(data: any): string | null {
  if (typeof data?.video?.url === "string") return data.video.url;
  for (const j of (data?.jobs || [])) {
    if (typeof j?.results?.raw?.url === "string") return j.results.raw.url;
    if (typeof j?.video?.url === "string") return j.video.url;
  }
  return null;
}

function jobSetStatus(data: any): string {
  return String(data?.status || data?.jobs?.[0]?.status || "").toUpperCase();
}

export const HiggsfieldVideoProvider = {
  name: "higgsfield" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    // image-to-video only — needs a source image URL. Without one, the
    // registry should fall through to a text-to-video provider.
    return (await getAuth(agentId)) !== null;
  },

  async generate(input: GenerateVideoInput, agentId: number): Promise<GenerateVideoOutput> {
    const auth = await getAuth(agentId);
    if (!auth) throw new Error("higgsfield: no credential resolved");
    if (!input.image || !/^https?:\/\//.test(input.image)) {
      throw new Error("higgsfield(dop) is image-to-video — pass a public image URL (share_file) as input.image");
    }
    const headers = { "hf-api-key": auth.id, "hf-secret": auth.secret, "Content-Type": "application/json" };

    const res = await fetch(`${BASE}/v1/image2video/dop`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        params: {
          prompt: input.prompt,
          input_images: [{ type: "image_url", image_url: input.image }],
        },
      }),
    });
    if (!res.ok) throw new Error(`higgsfield submit failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const submit = await res.json() as { id?: string; job_set_id?: string };
    const jobSetId = submit.id || submit.job_set_id;
    if (!jobSetId) throw new Error(`higgsfield: no job-set id in submit response: ${JSON.stringify(submit).slice(0, 200)}`);

    let url: string | null = null;
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`${BASE}/v1/job-sets/${jobSetId}`, { headers });
      if (!poll.ok) continue;
      const data = await poll.json();
      const status = jobSetStatus(data);
      url = videoUrl(data);
      if (url) break;
      if (status === "FAILED" || status === "CANCELED") throw new Error(`higgsfield video ${status}`);
      if (status === "NSFW") throw new Error("higgsfield: generation flagged nsfw");
    }
    if (!url) throw new Error("higgsfield: timed out / no video url");

    const dl = await fetch(url);
    if (!dl.ok) throw new Error(`higgsfield download failed: ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `video-${Date.now()}.mp4`);
    await fs.writeFile(filePath, buf);
    logger.info("higgsfield(dop) generated video");
    return { filePath, bytes: buf.byteLength, model: "higgsfield-dop" };
  },
};
