// OpenAI image generation — gpt-image-1 by default (replaces DALL-E 3 in
// the new API surface). Reuses the org's existing llm_api_key:openai
// credential so users who already brought their OpenAI key for chat get
// images for free (so to speak).

import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import { downloadAll } from "./replicate.js";
import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const DEFAULT_MODEL = "gpt-image-1";

async function getKey(agentId: number): Promise<string | null> {
  // Try llm_api_key:openai first (reuses an existing key the user already
  // brought for chat), then fall back to generic:openai.
  let cred = await fetchSecret({ agentId, provider: "openai", kind: "llm_api_key" });
  if (!cred) cred = await fetchSecret({ agentId, provider: "openai", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.fields?.value || cred.value;
}

export const OpenAiImageProvider = {
  name: "openai" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("openai: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);
    const size = input.size && input.size !== "auto" ? input.size : "1024x1024";

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: input.prompt, n, size }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`openai images failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json() as {
      data: Array<{ url?: string; b64_json?: string }>;
    };

    // OpenAI returns either URLs or base64. Handle both — older models /
    // some sizes default to b64.
    const urlEntries = data.data.filter((d) => d.url).map((d) => d.url!);
    if (urlEntries.length === data.data.length) {
      logger.info(`openai generated ${urlEntries.length} image(s) on ${model} (url mode)`);
      return downloadAll(urlEntries, model);
    }

    // b64 path — write to disk directly.
    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const files = await Promise.all(data.data.map(async (d, idx) => {
      if (d.url) {
        const r = await fetch(d.url);
        const buf = Buffer.from(await r.arrayBuffer());
        const fp = path.join(dir, `image-${ts}-${idx + 1}.png`);
        await fs.writeFile(fp, buf);
        return { filePath: fp, bytes: buf.byteLength, model };
      }
      const buf = Buffer.from(d.b64_json!, "base64");
      const fp = path.join(dir, `image-${ts}-${idx + 1}.png`);
      await fs.writeFile(fp, buf);
      return { filePath: fp, bytes: buf.byteLength, model };
    }));
    logger.info(`openai generated ${files.length} image(s) on ${model} (b64 mode)`);
    return { files };
  },
};
