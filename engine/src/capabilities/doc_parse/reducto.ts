// Reducto — table-heavy doc parsing, accounting/finance grade.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { ParseDocInput, ParseDocOutput } from "./types.js";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "reducto", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const ReductoProvider = {
  name: "reducto" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async parse(input: ParseDocInput, agentId: number): Promise<ParseDocOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("reducto: no credential resolved");

    let documentUrl = input.url;
    if (!documentUrl && input.file_path) {
      // Upload to Reducto's temp storage first.
      const full = path.resolve(config.dataDir, input.file_path);
      const bytes = await fs.readFile(full);
      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(bytes)]), path.basename(full));
      const upload = await fetch("https://platform.reducto.ai/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!upload.ok) throw new Error(`reducto upload failed: ${upload.status}`);
      const data = await upload.json() as { file_id?: string; url?: string };
      documentUrl = data.url || `reducto://${data.file_id}`;
    }

    const res = await fetch("https://platform.reducto.ai/parse", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ document_url: documentUrl }),
    });
    if (!res.ok) throw new Error(`reducto parse failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { result?: { chunks?: Array<{ content?: string }> } };

    const fmt = input.output_format || "markdown";
    const content = (data.result?.chunks || []).map((c) => c.content || "").join("\n\n");
    return {
      format: fmt,
      content: fmt === "json" ? JSON.stringify(data) : content,
      provider: "reducto",
      metadata: data.result,
    };
  },
};
