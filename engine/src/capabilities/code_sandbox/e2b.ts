// E2B — cloud sandbox via their REST API. Ephemeral micro-VM per call.
// Pricing: ~$0.000014/sec. Free tier: ~100 hrs/mo.
//
// We talk to E2B over their HTTP API rather than pulling in their SDK
// to keep the engine image lean.

import { promises as fs } from "fs";
import path from "path";
import { config } from "../../config.js";
import { fetchSecret } from "../../tools/secrets.js";
import { logger } from "../../logger.js";
import type { ExecuteCodeInput, ExecuteCodeOutput } from "./types.js";

const API_BASE = "https://api.e2b.dev";

async function getKey(agentId: number): Promise<string | null> {
  const cred = await fetchSecret({ agentId, provider: "e2b", kind: "generic" });
  if (!cred) return null;
  return cred.fields?.api_key || cred.value;
}

export const E2bProvider = {
  name: "e2b" as const,

  async isAvailable(agentId: number): Promise<boolean> {
    return (await getKey(agentId)) !== null;
  },

  async execute(input: ExecuteCodeInput, agentId: number): Promise<ExecuteCodeOutput> {
    const key = await getKey(agentId);
    if (!key) throw new Error("e2b: no credential resolved");

    const language = input.language || "python";
    const timeout = Math.min(input.timeout ?? 30, 300);

    // 1. Create a sandbox instance.
    const create = await fetch(`${API_BASE}/sandboxes`, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        templateID: language === "python" ? "code-interpreter-v1" : "base",
        timeout,
      }),
    });
    if (!create.ok) throw new Error(`e2b sandbox create failed: ${create.status} ${(await create.text()).slice(0, 200)}`);
    const sandbox = await create.json() as { sandboxID: string };

    try {
      // 2. Seed input files if any.
      for (const [filepath, content] of Object.entries(input.files || {})) {
        await fetch(`${API_BASE}/sandboxes/${sandbox.sandboxID}/files`, {
          method: "POST",
          headers: { "X-API-KEY": key, "Content-Type": "application/octet-stream", "X-File-Path": filepath },
          body: content,
        });
      }

      // 3. Run the code via the sandbox's exec endpoint.
      const cmd = language === "python"
        ? ["python3", "-c", input.code]
        : language === "javascript"
        ? ["node", "-e", input.code]
        : ["bash", "-c", input.code];

      const run = await fetch(`${API_BASE}/sandboxes/${sandbox.sandboxID}/exec`, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: cmd[0], args: cmd.slice(1), timeout_ms: timeout * 1000 }),
      });
      if (!run.ok) throw new Error(`e2b exec failed: ${run.status} ${(await run.text()).slice(0, 200)}`);
      const result = await run.json() as { stdout?: string; stderr?: string; exitCode?: number };

      // 4. List + pull any files the run produced (under /home/user/).
      let producedFiles: Array<{ path: string; bytes: number; preview?: string }> = [];
      try {
        const list = await fetch(`${API_BASE}/sandboxes/${sandbox.sandboxID}/files?path=/home/user`, {
          headers: { "X-API-KEY": key },
        });
        if (list.ok) {
          const files = (await list.json() as { files?: Array<{ path: string; size: number }> }).files || [];
          producedFiles = await Promise.all(files.slice(0, 5).map(async (f) => {
            const download = await fetch(`${API_BASE}/sandboxes/${sandbox.sandboxID}/files?path=${encodeURIComponent(f.path)}`, {
              headers: { "X-API-KEY": key },
            });
            const buf = Buffer.from(await download.arrayBuffer());
            // Save to workspace so the agent can chain into send_file.
            const dir = path.join(config.dataDir, "workspace", "sandbox");
            await fs.mkdir(dir, { recursive: true });
            const local = path.join(dir, path.basename(f.path));
            await fs.writeFile(local, buf);
            const preview = buf.length < 4096 ? buf.toString("utf8").slice(0, 500) : undefined;
            return { path: local, bytes: buf.length, preview };
          }));
        }
      } catch (err) {
        logger.warn("e2b file list/pull skipped", { error: (err as Error).message });
      }

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exit_code: result.exitCode ?? -1,
        produced_files: producedFiles,
        ok: (result.exitCode ?? 1) === 0,
      };
    } finally {
      // 5. Always tear down the sandbox.
      await fetch(`${API_BASE}/sandboxes/${sandbox.sandboxID}`, {
        method: "DELETE",
        headers: { "X-API-KEY": key },
      }).catch(() => {});
    }
  },
};
