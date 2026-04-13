import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { host } from "../host/index.js";
import { logger } from "../logger.js";

// Reads a file from the agent workspace and uploads it via the Host abstraction.
// Returns the blob's signed_id (Rails ActiveStorage), or null on failure.
//
// Used by the outbox processor to attach files to outbound emails. Generic blob
// upload (e.g. inbound media from Telegram/WhatsApp) bypasses this and calls
// host.uploadBlob directly with bytes.
export async function uploadAttachment(relPath: string): Promise<string | null> {
  const fullPath = path.join(config.dataDir, "workspace", relPath);
  if (!fs.existsSync(fullPath)) {
    logger.warn(`Attachment not found: ${fullPath}`);
    return null;
  }

  try {
    const bytes = fs.readFileSync(fullPath);
    const filename = path.basename(fullPath);
    const contentType = guessContentType(filename);

    const result = await host.uploadBlob(bytes, filename, contentType);
    logger.info(`Uploaded attachment: ${filename} (${result.byte_size} bytes)`);
    return result.signed_id;
  } catch (err) {
    logger.error(`Attachment upload error: ${(err as Error).message}`);
    return null;
  }
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
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".md": "text/markdown",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
  };
  return map[ext] || "application/octet-stream";
}
