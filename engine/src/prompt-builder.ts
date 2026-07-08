import { readMemoryMd, getMemoryUsage } from "./memory.js";
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

export interface KnowledgePrefetch {
  query: string;
  passages: Array<{
    document_title: string;
    chunk_index: number;
    content: string;
    context: string | null;
    distance: number;
  }>;
}

export function buildPrompt(
  agent: Agent,
  job: JobData,
  history: Message[],
  conversation?: Conversation | null,
  processedAttachments?: ProcessedAttachment[],
  taskCheckpoint?: Record<string, unknown> | null,
  knowledgePrefetch?: KnowledgePrefetch | null,
): BuiltPrompt {
  const parts: string[] = [];

  // If we pre-ran search_knowledge deterministically (because the user's
  // message clearly references uploaded docs), inject the results up-front
  // so the agent doesn't have to "decide" to search. Eliminates the
  // prompt-compliance risk where the agent uses Read/Grep instead.
  if (knowledgePrefetch && knowledgePrefetch.passages.length > 0) {
    parts.push("## 📚 Knowledge base retrieval (pre-fetched)");
    parts.push(
      `We ran \`search_knowledge({ query: "${knowledgePrefetch.query}" })\` on your behalf. ` +
      `Use these passages to answer the user, and **cite the document titles** in your response. ` +
      `If they don't fully answer the question, call \`search_knowledge\` again with a different query.`,
    );
    parts.push("");
    for (const [i, p] of knowledgePrefetch.passages.entries()) {
      parts.push(`### [${i + 1}] From "${p.document_title}" (chunk ${p.chunk_index + 1}, distance ${p.distance.toFixed(3)})`);
      if (p.context) parts.push(`*Context: ${p.context}*`);
      parts.push(p.content);
      parts.push("");
    }
  }

  // Inject memory with usage indicator (bounded to 2200 chars)
  const memory = readMemoryMd();
  if (memory && memory.trim() !== "# Memory\n\nNo memories yet.") {
    parts.push(`## Your Memory — ${getMemoryUsage()}\n${memory}\n`);
  }
  parts.push("After this interaction, update memories/memory.md with any new important facts you learn. Keep it concise — you have a 2200 character limit.\n");

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
      parts.push(
        `## Heartbeat check (automated — not a user message)\n` +
        `Do NOT greet the user or ask what they need. ` +
        `This is an automated check — execute the instruction directly:\n\n` +
        `${job.payload?.instruction || "Check if anything needs your attention — pending tasks, unread messages, due follow-ups."}`,
      );
      break;
    case "scheduled_task": {
      // Strip the [SILENT] routing prefix so the agent only sees the actual instruction.
      let schedInstruction = job.payload?.instruction || "Execute your scheduled task.";
      schedInstruction = schedInstruction.replace(/^\[SILENT\]\s*/i, "");
      parts.push(
        `## Scheduled task (automated — not a user message)\n` +
        `Execute the following instruction. Do NOT greet the user or ask what they need. ` +
        `This is an automated scheduled job — go directly to the task:\n\n${schedInstruction}\n\n` +
        `Memory discipline for scheduled runs: run status, blockers, pending drafts, and "do X every day" ` +
        `notes belong in your REPLY, not in persistent memory. Never write standing directives into memory ` +
        `from a scheduled run that would change how you answer normal chat messages — when a user says hello ` +
        `tomorrow, they want their question answered, not this task re-run. Durable business facts you learned ` +
        `are fine to remember.`,
      );
      break;
    }
    case "task_assignment":
      if (job.jobId?.startsWith("task-reportback-")) {
        parts.push(
          `## Report-back mode\n` +
          `You are processing the result of work you delegated to another agent. Do not use tools, do not research, do not create files, and do not mutate tasks in this mode.\n\n` +
          `Your job is to read the report below and produce a concise status update for the original requester. If the report says the work is blocked or incomplete, say exactly what is blocked and what input or connection is needed.\n\n` +
          `${job.payload?.instruction || ""}`,
        );
        break;
      }
      parts.push(`You have been assigned a task (ID: ${job.payload?.taskId}):\n${job.payload?.instruction || ""}`);
      if (taskCheckpoint && Object.keys(taskCheckpoint).length > 0) {
        // Step 5.5 — resume from prior progress if the agent checkpointed it.
        parts.push("");
        parts.push("## Resuming task — prior checkpoint:");
        parts.push("```json");
        parts.push(JSON.stringify(taskCheckpoint, null, 2));
        parts.push("```");
        parts.push("Continue from this state. Call write_checkpoint every 10-20 steps so you don't lose progress if interrupted.");
      }
      parts.push(
        "\nComplete this task thoroughly." +
        "\n- Save progress with write_checkpoint after each major phase or every 10-20 steps — this is automatic, don't wait to be asked." +
        "\n- If you need clarification, call ask_user — your turn ends and the user's reply re-engages you." +
        "\n- When fully done, use comment_on_task({ task_id: " + (job.payload?.taskId || "ID") + ", content: \"your findings\" }) to post your results.",
      );
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
