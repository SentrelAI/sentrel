// Captures Write tool calls that target the email outbox.
// Used as a fallback in case the file write fails or the agent
// doesn't actually flush the file to disk.

export interface CapturedEmail {
  to: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_text?: string;
  body_html?: string;
  attachments?: string[];
}

export class ToolInterceptor {
  private emails: CapturedEmail[] = [];

  // Inspect a tool_use block from the SDK stream and capture if relevant.
  observe(block: { type: string; name?: string; input?: Record<string, unknown> }): void {
    if (block.type !== "tool_use") return;
    if (block.name !== "Write") return;

    const filePath = block.input?.file_path;
    if (typeof filePath !== "string") return;
    if (!filePath.includes("outbox") || !filePath.endsWith(".json")) return;

    try {
      const content = block.input?.content;
      if (typeof content !== "string") return;
      const data = JSON.parse(content) as CapturedEmail;
      if (data.to) this.emails.push(data);
    } catch {
      // ignore malformed JSON — outbox processor will pick it up from disk
    }
  }

  capturedEmails(): CapturedEmail[] {
    return this.emails;
  }
}
