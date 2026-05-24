// Google AI image generation — Imagen 3 via the Gemini API.
// Reuses generic:google_ai (preferred) or llm_api_key:google_ai.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { GenerateImageInput, GenerateImageOutput } from "./types.js";

const DEFAULT_MODEL = "imagen-3.0-generate-001";

async function getKey(agentId: number): Promise<string | null> {
  let cred = await fetchSecret({ agentId, provider: "google_ai", kind: "generic" });
  if (!cred) cred = await fetchSecret({ agentId, provider: "google_ai", kind: "llm_api_key" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.fields?.value || cred.value;
}

export const GoogleAiImageProvider = {
  name: "google_ai" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async generate(input: GenerateImageInput, agentId: number): Promise<GenerateImageOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("google_ai: no credential resolved");

    const model = input.model || DEFAULT_MODEL;
    const n = Math.min(Math.max(input.n ?? 1, 1), 4);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: input.prompt }],
        parameters: {
          sampleCount: n,
          aspectRatio: input.aspect_ratio || "1:1",
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`google_ai imagen failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const predictions = data.predictions || [];
    if (predictions.length === 0) throw new Error("google_ai returned no predictions");

    const dir = path.join(config.dataDir, "workspace", "generated");
    await fs.mkdir(dir, { recursive: true });
    const ts = Date.now();
    const files = await Promise.all(predictions.map(async (p, idx) => {
      if (!p.bytesBase64Encoded) throw new Error("google_ai prediction missing base64 image");
      const buf = Buffer.from(p.bytesBase64Encoded, "base64");
      const ext = p.mimeType?.includes("png") ? "png" : "jpg";
      const filePath = path.join(dir, `image-${ts}-${idx + 1}.${ext}`);
      await fs.writeFile(filePath, buf);
      return { filePath, bytes: buf.byteLength, model };
    }));
    logger.info(`google_ai generated ${files.length} image(s) on ${model}`);
    return { files };
  },
};
