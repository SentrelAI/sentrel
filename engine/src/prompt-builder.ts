import { readMemoryMd } from "./memory.js";
import type { Agent, Conversation, JobData, Message } from "./types.js";
import type { ProcessedAttachment } from "./media/pipeline.js";

// Sprint 0c — return SDK content blocks instead of a string.
// For now (text-only) each call returns a single user message with one text block.
// In Sprint 2 we'll add image and document blocks alongside the text for multimodal.
//
// Note: SDKUserMessage is the streaming-input form. We re-declare a minimal subset
// here to avoid pulling in the SDK type at the prompt-builder layer.
export interface UserMessageInput {
  type: "user";
  message: {
    role: "user";
    content: TextBlock[];
    // Sprint 2 will extend with: ImageBlock | DocumentBlock
  };
  parent_tool_use_id: null;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface BuiltPrompt {
  messages: UserMessageInput[];
  // The plain-text equivalent for audit logging (truncated to 500 chars by caller)
  promptText: string;
}

export function buildPrompt(
  agent: Agent,
  job: JobData,
  history: Message[],
  conversation?: Conversation | null,
  processedAttachments?: ProcessedAttachment[],
): BuiltPrompt {
  const parts: string[] = [];

  // Inject memory directly into prompt
  const memory = readMemoryMd();
  if (memory && memory.trim() !== "# Memory\n\nNo memories yet.") {
    parts.push("## Your Memory (accumulated knowledge):\n" + memory + "\n");
  }
  parts.push("After this interaction, update memory/MEMORY.md with any new important facts you learn.\n");

  // Conversation summaries (older context, compressed) — Sprint 0b
  // These accumulate over the lifetime of the conversation as Claude sessions rotate.
  // The agent always sees them so context is never lost on rotation.
  if (conversation?.summaries && conversation.summaries.length > 0) {
    parts.push("## Conversation summary (older context):");
    for (const s of conversation.summaries) {
      parts.push(`### Turns ${s.turn_range} (summarized ${s.summarized_at}):`);
      parts.push(s.summary);
    }
    parts.push("");
  }

  // Conversation history (most recent messages, verbatim)
  if (history.length > 0) {
    const senderName = job.payload?.from_name || job.payload?.from || "User";
    parts.push("## Conversation history with " + senderName + ":");
    for (const msg of history) {
      const role = msg.role === "user" ? senderName : agent.name;
      parts.push(`**${role}**: ${msg.content}`);
    }
    parts.push("");
  }

  // Current job
  switch (job.type) {
    case "inbound_message":
      parts.push(...buildInboundMessageContext(job));
      break;
    case "heartbeat":
      parts.push(job.payload?.instruction || "Heartbeat check — anything need attention?");
      break;
    case "scheduled_task":
      parts.push(`Scheduled task: ${job.payload?.instruction || "Execute your scheduled task."}`);
      break;
    case "task_assignment":
      parts.push(`You have been assigned a task:\n${job.payload?.instruction || ""}`);
      parts.push("\nComplete this task thoroughly and report your results.");
      break;
  }

  // Sprint 2 — media attachments: voice transcripts inline, files as Read paths
  if (processedAttachments && processedAttachments.length > 0) {
    parts.push("");
    parts.push("## Attached media from this message:");
    for (const att of processedAttachments) {
      if (att.transcript) {
        // Voice notes and text files — content is inlined
        parts.push(`\n### ${att.description}`);
        parts.push(att.transcript);
      } else if (att.workspacePath) {
        // PDFs, images, office docs — saved to workspace for the agent to Read
        parts.push(`\n- ${att.description}`);
        parts.push(`  File path: ${att.workspacePath}`);
      }
    }
    // Remind the agent how to access the files
    const filePaths = processedAttachments
      .filter((a) => a.workspacePath)
      .map((a) => a.workspacePath);
    if (filePaths.length > 0) {
      parts.push("");
      parts.push(
        "To view these files, use the Read tool with the file paths above. " +
        "The Read tool supports images (vision), PDFs (document reading), " +
        "and most text-based formats. Read each file you need to answer the user's question."
      );
    }
  }

  const promptText = parts.join("\n");

  return {
    messages: [
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: promptText }],
        },
        parent_tool_use_id: null,
      },
    ],
    promptText,
  };
}

function buildInboundMessageContext(job: JobData): string[] {
  const from = job.payload?.from_name || job.payload?.from || "someone";
  const channel = job.channel || "message";
  const parts: string[] = [];

  parts.push(`New ${channel} from ${from}:`);
  if (job.payload?.subject) parts.push(`Subject: ${job.payload.subject}`);
  parts.push(`\n${job.payload?.body || ""}`);

  // Per-channel reply context. The agent's persona, tone rules, email formatting
  // rules, and "you are not an AI assistant" guardrails all live in the system
  // prompt now (Sprint 0a) — we don't repeat them here.
  if (channel === "email") {
    parts.push(...buildEmailReplyContext(job));
  }

  return parts;
}

function buildEmailReplyContext(job: JobData): string[] {
  const ccList = job.payload?.cc || [];
  const parts: string[] = [];

  parts.push("");
  parts.push("Reply via the send-email skill (write a JSON file to workspace/outbox/).");
  parts.push(`Reply-To: ${job.payload?.from}`);
  if (ccList.length > 0) {
    parts.push(`CC (keep these recipients in the loop): ${ccList.join(", ")}`);
  }
  if (job.payload?.subject) {
    parts.push(`Original subject: ${job.payload.subject}`);
  }

  return parts;
}
