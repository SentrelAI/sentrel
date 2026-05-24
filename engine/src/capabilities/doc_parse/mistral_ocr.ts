// Mistral OCR — fast, accurate, multi-language. Uses Mistral API.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { ParseDocInput, ParseDocOutput } from "./types.js";

async function getKey(agentId: number): Promise<string | null> {
  let cred = await fetchSecret({ agentId, provider: "mistral_ocr", kind: "generic" });
  if (!cred) cred = await fetchSecret({ agentId, provider: "mistral", kind: "llm_api_key" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.fields?.value || cred.value;
}

export const MistralOcrProvider = {
  name: "mistral_ocr" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async parse(input: ParseDocInput, agentId: number): Promise<ParseDocOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("mistral_ocr: no credential resolved");

    let document: Record<string, string>;
    if (input.url) {
      document = { type: "document_url", document_url: input.url };
    } else if (input.file_path) {
      const full = path.resolve(config.dataDir, input.file_path);
      const bytes = await fs.readFile(full);
      document = { type: "document_url", document_url: `data:application/pdf;base64,${bytes.toString("base64")}` };
    } else {
      throw new Error("file_path or url required");
    }

    const res = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mistral-ocr-latest", document }),
    });
    if (!res.ok) throw new Error(`mistral OCR failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as {
      pages?: Array<{ markdown?: string; text?: string }>;
    };
    const content = (data.pages || []).map((p) => p.markdown || p.text || "").join("\n\n---\n\n");

    return {
      format: input.output_format || "markdown",
      content,
      provider: "mistral_ocr",
      pages: data.pages?.length,
    };
  },
};
