// Image generation MCP server. One tool: `generate_image`. Routing
// (replicate / fal / openai / google_ai) happens inside via the registry.
//
// Returns file paths inside /data/workspace/generated/ — the agent is
// expected to chain into send_image to actually deliver them to the user.

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../../logger.js";
import { getActiveImageGenProvider } from "./registry.js";
import type { Agent } from "../../types.js";

export function buildImageGenMcpServer(agent: Agent) {
  const generateTool = tool(
    "generate_image",
    "Generate one or more images from a text prompt. Saves the result(s) to workspace/generated/ and returns the file path(s) so you can pass them to send_image. Always include enough detail in the prompt — describe subject, style, lighting, framing. Bad prompts produce mediocre images regardless of model.",
    {
      prompt: z.string().describe("The image description. Detailed wins: subject, action, environment, style, lighting, framing. e.g. 'a fox in a top hat sitting at a typewriter, dim study, warm desk lamp, oil painting style, 35mm photo composition'."),
      n: z.number().int().min(1).max(4).optional().describe("How many variations (default 1, max 4)."),
      aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().describe("Aspect ratio. Default 1:1."),
      size: z.string().optional().describe("Provider-specific size (e.g. '1024x1024' for openai). Most users should set aspect_ratio instead."),
      model: z.string().optional().describe("Override the provider's default model (e.g. 'black-forest-labs/flux-1.1-pro' for higher quality on replicate)."),
    },
    async (args) => {
      try {
        const p = await getActiveImageGenProvider(agent);
        const out = await p.generate(
          { prompt: args.prompt, n: args.n, aspect_ratio: args.aspect_ratio, size: args.size, model: args.model },
          agent.id,
        );
        const lines = out.files.map((f, i) => `${i + 1}. ${f.filePath} (${Math.round(f.bytes / 1024)} KB, ${f.model})`);
        return {
          content: [{
            type: "text" as const,
            text:
              `Generated ${out.files.length} image(s) via ${p.name}:\n${lines.join("\n")}\n\n` +
              `Next: pass any of these paths to send_image to deliver to the user.`,
          }],
        };
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        logger.warn("image_gen.generate failed", { error: msg });
        return { content: [{ type: "text" as const, text: `image generation failed: ${msg}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "image",
    version: "1.0.0",
    tools: [generateTool],
  });
}
