// Code sandbox MCP — mcp__code__execute. Runs Python / JS / bash in an
// isolated micro-VM, returns stdout / stderr / exit_code / produced files.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../../logger.js";
import { getActiveCodeSandboxProvider } from "./registry.js";
import type { Agent } from "../../types.js";

export function buildCodeSandboxMcpServer(agent: Agent) {
  const executeTool = tool(
    "execute",
    "Run code in an isolated cloud sandbox (E2B / Modal). Default Python. Use for data analysis " +
      "(pandas, matplotlib, numpy), running model-generated scripts, generating charts/plots, or " +
      "anything that needs a real runtime — NOT for production code execution. The sandbox is " +
      "ephemeral; produced files come back inline and are saved under workspace/sandbox/ for " +
      "send_file to deliver.",
    {
      code: z.string().describe("The full source to run. Python by default. Include imports."),
      language: z.enum(["python", "javascript", "bash"]).optional().describe("Default 'python'. Use 'bash' for shell, 'javascript' for Node."),
      timeout: z.number().int().min(1).max(300).optional().describe("Seconds, default 30, max 300."),
      files: z.record(z.string(), z.string()).optional().describe("Files to seed into the sandbox before run. { 'data.csv': '<csv content>' }."),
    },
    async (args) => {
      try {
        const p = await getActiveCodeSandboxProvider(agent);
        const out = await p.execute(args, agent.id);
        const lines = [
          `Ran via ${p.name} (exit ${out.exit_code}${out.ok ? "" : " — non-zero"}):`,
          "",
          out.stdout ? `--- stdout ---\n${out.stdout.slice(0, 4000)}` : "(no stdout)",
        ];
        if (out.stderr) lines.push(`\n--- stderr ---\n${out.stderr.slice(0, 2000)}`);
        if (out.produced_files.length) {
          lines.push("\n--- produced files ---");
          for (const f of out.produced_files) {
            lines.push(`${f.path} (${f.bytes}B)${f.preview ? `\n${f.preview.slice(0, 200)}` : ""}`);
          }
          lines.push("\nPass these paths to send_file (or send_image for PNGs) to deliver to the user.");
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }], isError: !out.ok };
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        logger.warn("code_sandbox.execute failed", { error: msg });
        return { content: [{ type: "text" as const, text: `code sandbox failed: ${msg}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "code",
    version: "1.0.0",
    tools: [executeTool],
  });
}
