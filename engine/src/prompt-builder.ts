import { readMemoryMd } from "./memory.js";
import type { Agent, JobData, Message } from "./types.js";

export function buildPrompt(agent: Agent, job: JobData, history: Message[]): string {
  const parts: string[] = [];

  // Inject memory directly into prompt
  const memory = readMemoryMd();
  if (memory && memory.trim() !== "# Memory\n\nNo memories yet.") {
    parts.push("## Your Memory (accumulated knowledge):\n" + memory + "\n");
  }
  parts.push("After this interaction, update memory/MEMORY.md with any new important facts you learn.\n");

  // Conversation history
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

  return parts.join("\n");
}

function buildInboundMessageContext(job: JobData): string[] {
  const from = job.payload?.from_name || job.payload?.from || "someone";
  const channel = job.channel || "message";
  const parts: string[] = [];

  parts.push(`New ${channel} from ${from}:`);
  if (job.payload?.subject) parts.push(`Subject: ${job.payload.subject}`);
  parts.push(`\n${job.payload?.body || ""}`);

  if (channel === "email") {
    parts.push(...buildEmailReplyInstructions(job));
  } else {
    parts.push("\nRespond as yourself (not as an AI assistant). Use your personality and follow your instructions.");
  }

  return parts;
}

function buildEmailReplyInstructions(job: JobData): string[] {
  const ccList = job.payload?.cc || [];
  const parts: string[] = [];

  parts.push("\nYou received this as an email. Reply via the send-email skill:");
  parts.push("Write a JSON file to workspace/outbox/ with: to, cc, bcc, subject, body_text");
  parts.push(`Reply-To: ${job.payload?.from}`);
  if (ccList.length > 0) {
    parts.push(`CC (include in your reply to keep them in the loop): ${ccList.join(", ")}`);
  }
  parts.push("");
  parts.push("CRITICAL EMAIL RULES:");
  parts.push("- DO NOT use emojis (no 🚀 🏥 ✅ etc.)");
  parts.push("- DO NOT use markdown formatting (no **bold**, no bullets with *)");
  parts.push("- Write in plain professional prose, like a real human email");
  parts.push("- Keep the same subject line (prefix with 'Re: ' if not already)");
  parts.push("- DO NOT add a signature — the system appends one automatically");
  parts.push("- End your message with 'Best,' or similar but DO NOT add your name/email after — that comes from the signature");

  return parts;
}
