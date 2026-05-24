// LlamaParse — Llama Cloud's document parser. Best-in-class for
// PDFs with tables / forms / scanned text. Free tier: 1000 pages/day.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import type { ParseDocInput, ParseDocOutput } from "./types.js";

const API_BASE = "https://api.cloud.llamaindex.ai/api/v1/parsing";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "llamaparse", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

async function readBytes(input: ParseDocInput): Promise<{ bytes: Buffer; filename: string }> {
  if (input.file_path) {
    const full = path.resolve(config.dataDir, input.file_path);
    const bytes = await fs.readFile(full);
    return { bytes, filename: path.basename(full) };
  }
  if (input.url) {
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(`fetch ${input.url} failed: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const filename = path.basename(new URL(input.url).pathname) || "document.pdf";
    return { bytes, filename };
  }
  throw new Error("file_path or url required");
}

export const LlamaparseProvider = {
  name: "llamaparse" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async parse(input: ParseDocInput, agentId: number): Promise<ParseDocOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("llamaparse: no credential resolved");
    const { bytes, filename } = await readBytes(input);

    // Step 1: upload + create job.
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(bytes)]), filename);
    fd.append("language", "en");
    const upload = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!upload.ok) throw new Error(`llamaparse upload failed: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
    const job = await upload.json() as { id: string };

    // Step 2: poll for completion.
    let status: { status: string } = { status: "PENDING" };
    let polls = 0;
    while (status.status !== "SUCCESS" && status.status !== "ERROR" && polls < 60) {
      await new Promise((r) => setTimeout(r, 2000));
      polls++;
      const s = await fetch(`${API_BASE}/job/${job.id}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!s.ok) break;
      status = await s.json() as { status: string };
    }
    if (status.status !== "SUCCESS") throw new Error(`llamaparse job ${status.status}`);

    // Step 3: fetch result in requested format.
    const fmt = input.output_format || "markdown";
    const endpoint = fmt === "json" ? "result/json" : (fmt === "text" ? "result/text" : "result/markdown");
    const result = await fetch(`${API_BASE}/job/${job.id}/${endpoint}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!result.ok) throw new Error(`llamaparse result fetch failed: ${result.status}`);
    const data = fmt === "json"
      ? JSON.stringify(await result.json())
      : (await result.json() as { markdown?: string; text?: string }).markdown ||
        (await result.json() as { markdown?: string; text?: string }).text ||
        await result.text();

    return { format: fmt, content: data, provider: "llamaparse" };
  },
};
