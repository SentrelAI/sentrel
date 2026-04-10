import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Uploads a file from the agent workspace to Rails, returns the blob signed_id.
// Used by the outbox processor to attach files to outbound emails.
export async function uploadAttachment(relPath: string): Promise<string | null> {
  const fullPath = path.join(config.dataDir, "workspace", relPath);
  if (!fs.existsSync(fullPath)) {
    logger.warn(`Attachment not found: ${fullPath}`);
    return null;
  }

  const railsUrl = process.env.RAILS_API_URL || "http://localhost:3200";
  const secret = process.env.ENGINE_API_SECRET || "";
  if (!secret) {
    logger.warn("ENGINE_API_SECRET not set, cannot upload attachment");
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(fullPath);
    const filename = path.basename(fullPath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), filename);

    const res = await fetch(`${railsUrl}/api/blobs`, {
      method: "POST",
      headers: { "X-Engine-Secret": secret },
      body: formData,
    });

    if (!res.ok) {
      logger.error(`Attachment upload failed: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json() as { signed_id: string };
    logger.info(`Uploaded attachment: ${filename}`);
    return data.signed_id;
  } catch (err) {
    logger.error(`Attachment upload error: ${(err as Error).message}`);
    return null;
  }
}
