import fs from "fs";
import path from "path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { synthesize } from "../media/providers/tts.js";
import { sendMedia } from "../media/channel-sender.js";

// Build the send-media MCP server. The current job's channel + metadata are
// baked into the closure so the agent doesn't need to specify routing.
export function buildSendMediaMcpServer(
  channel: string,
  metadata: Record<string, unknown>,
) {
  const sendVoiceTool = tool(
    "send_voice",
    "Convert text to speech and send as a voice message to the current conversation. " +
      "Use when the user asks you to 'send a voice note', 'say this out loud', or " +
      "when a voice response feels more natural than text.",
    {
      text: z.string().describe("The text to speak. Keep it conversational and natural."),
      voice: z.string().optional().describe("Voice name/ID (optional, uses default)."),
    },
    async (args) => {
      try {
        const { bytes, contentType, filename } = await synthesize(args.text, args.voice);
        await sendMedia({
          channel,
          bytes,
          filename,
          contentType,
          metadata,
        });
        return { content: [{ type: "text", text: `Voice message sent (${args.text.length} chars)` }] };
      } catch (err) {
        logger.error("send_voice failed", { error: (err as Error).message });
        return { content: [{ type: "text", text: `Failed to send voice: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const sendImageTool = tool(
    "send_image",
    "Send an image file from the workspace to the current conversation. " +
      "Use for screenshots, generated images, charts, or any visual content. " +
      "The file must already exist in your workspace.",
    {
      file_path: z.string().describe("Path to the image file relative to workspace root (e.g. 'workspace/screenshots/chart.png')"),
      caption: z.string().optional().describe("Optional caption to send with the image."),
    },
    async (args) => {
      return sendWorkspaceFile(args.file_path, args.caption, channel, metadata, "image");
    },
  );

  const sendFileTool = tool(
    "send_file",
    "Send a file (PDF, CSV, document, etc.) from the workspace to the current " +
      "conversation. The file must already exist in your workspace.",
    {
      file_path: z.string().describe("Path to the file relative to workspace root (e.g. 'workspace/reports/q4.pdf')"),
      caption: z.string().optional().describe("Optional message to send with the file."),
    },
    async (args) => {
      return sendWorkspaceFile(args.file_path, args.caption, channel, metadata, "file");
    },
  );

  return createSdkMcpServer({
    name: "send-media",
    version: "0.1.0",
    tools: [sendVoiceTool, sendImageTool, sendFileTool],
  });
}

// Read a file from the workspace and send it via the channel
async function sendWorkspaceFile(
  filePath: string,
  caption: string | undefined,
  channel: string,
  metadata: Record<string, unknown>,
  type: "image" | "file",
) {
  try {
    // Resolve relative to dataDir
    const fullPath = path.resolve(config.dataDir, filePath);

    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }], isError: true };
    }

    const bytes = fs.readFileSync(fullPath);
    const filename = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    const contentTypeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp",
      ".pdf": "application/pdf", ".csv": "text/csv",
      ".doc": "application/msword", ".txt": "text/plain",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".mp3": "audio/mpeg", ".mp4": "video/mp4",
      ".ogg": "audio/ogg", ".opus": "audio/opus",
    };
    const contentType = contentTypeMap[ext] || "application/octet-stream";

    await sendMedia({ channel, bytes, filename, contentType, caption, metadata });

    logger.info(`send_${type}: sent ${filename} via ${channel} (${bytes.length}b)`);
    return { content: [{ type: "text" as const, text: `${type === "image" ? "Image" : "File"} sent: ${filename}` }] };
  } catch (err) {
    logger.error(`send_${type} failed`, { error: (err as Error).message });
    return { content: [{ type: "text" as const, text: `Failed: ${(err as Error).message}` }], isError: true };
  }
}
