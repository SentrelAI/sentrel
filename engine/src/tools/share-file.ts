// share-file — agent publishes a file from its sandbox workspace to a
// public URL so humans on chat/email can download it. Wraps the
// /api/blobs upload pipeline (ActiveStorage on Rails side) and returns
// the user-facing URL the agent should drop into its reply.
//
// Why this exists:
//   When an agent renders a video, generates a CSV report, or assembles
//   a PDF in /data/workspace/, the file lives ONLY on the agent's Fly
//   Machine. Saying 'download it at /data/workspace/foo.mp4' in chat
//   gives the user a path that only exists inside the sandbox — they
//   can't fetch it. This tool publishes the bytes via /api/blobs and
//   gives back `https://<RAILS_HOST>/api/blobs/<signed_id>` which
//   anyone with the link can open.
//
// Signed ids are unguessable (Rails MessageVerifier-signed), so URL =
// access. Don't paste them in public channels with sensitive files.

import fs from "fs";
import path from "path";
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { host } from "../host/index.js";
import { config } from "../config.js";
import { railsPublicUrl, isStalePublicUrl } from "../host/rails-url.js";

interface ShareContext {
  agentId: number;
}

export function buildShareFileMcpServer(_ctx: ShareContext) {
  return createSdkMcpServer({
    name: "share-file",
    version: "1.0.0",
    tools: [
      tool(
        "share_file",
        "Publish a file from your workspace to a public URL. Use this ANY time you produce a file the user needs to download (rendered video, CSV report, PDF, image, transcript). Returns a public HTTPS URL — paste it in your chat reply. Without this, files only exist on your sandbox and the user can't reach them.",
        {
          path: z
            .string()
            .describe("Path to the file. Either relative to your /data/workspace/ root (e.g. 'hdi-launch-video/renders/final.mp4') or an absolute path inside /data/ — both work."),
          display_name: z
            .string()
            .optional()
            .describe("Optional. Filename the user sees on download. Defaults to the file's actual basename."),
        },
        async (args) => {
          try {
            const absPath = resolveWorkspacePath(args.path);
            if (!fs.existsSync(absPath)) {
              return {
                content: [{ type: "text", text: `File not found: ${absPath}. Check the path — it should be relative to /data/workspace/ or an absolute /data/ path.` }],
                isError: true,
              };
            }

            const stat = fs.statSync(absPath);
            if (!stat.isFile()) {
              return {
                content: [{ type: "text", text: `Not a file: ${absPath}. share_file only works on files, not directories.` }],
                isError: true,
              };
            }

            const bytes = fs.readFileSync(absPath);
            const filename = args.display_name?.trim() || path.basename(absPath);
            const contentType = guessContentType(filename);

            const result = await host.uploadBlob(bytes, filename, contentType);
            if (isStalePublicUrl()) {
              // eslint-disable-next-line no-console
              console.warn(
                `[share-file] WARNING: railsPublicUrl=${railsPublicUrl()} on Fly machine — env stale. ` +
                `Run AgentMachineOps.reload(agent) from Rails console to push fresh env.`,
              );
            }
            const url = `${railsPublicUrl()}/api/blobs/${result.signed_id}`;

            logger.info(`share_file: published ${filename} (${stat.size} bytes) → ${url}`);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    url,
                    signed_id: result.signed_id,
                    filename,
                    bytes: stat.size,
                    content_type: contentType,
                    note: "Anyone with this URL can download the file. Don't paste in public channels if the contents are sensitive.",
                  }),
                },
              ],
            };
          } catch (err) {
            logger.error("share_file failed", err);
            return {
              content: [{ type: "text", text: `share_file error: ${(err as Error).message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}

function resolveWorkspacePath(p: string): string {
  // Accept three shapes:
  //   - already absolute under /data → use as-is
  //   - relative path → resolved against /data/workspace
  //   - leading slash (but not /data/) → still relative-to-workspace
  //     so the agent can't escape /data
  if (p.startsWith("/data/")) return p;
  const trimmed = p.replace(/^\/+/, "");
  return path.join(config.dataDir, "workspace", trimmed);
}

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".md": "text/markdown",
    ".html": "text/html",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}
