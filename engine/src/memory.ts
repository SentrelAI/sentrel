import fs from "fs";
import path from "path";
import { config } from "./config.js";
import * as db from "./db.js";
import type { Agent } from "./types.js";
import { logger } from "./logger.js";

const dataDir = config.dataDir;

export function ensureWorkspace(): void {
  const dirs = [
    dataDir,
    path.join(dataDir, ".claude", "skills"),
    path.join(dataDir, "memory"),
    path.join(dataDir, "workspace"),
    path.join(dataDir, "workspace", "outbox"),
    path.join(dataDir, "browser"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function syncClaudeMd(agent: Agent): void {
  const parts: string[] = [];

  if (agent.identity_md) {
    parts.push("# Identity\n" + agent.identity_md);
  }

  if (agent.personality_md) {
    parts.push("# Personality\n" + agent.personality_md);
  }

  if (agent.organization?.context_md) {
    parts.push("# About My Organization\n" + agent.organization.context_md);
  }

  if (agent.instructions_md) {
    parts.push("# Instructions\n" + agent.instructions_md);
  }

  parts.push(
    "# Sending Emails\n" +
    "You have FULL permission to use the Write tool. All permissions are pre-approved.\n" +
    "To send an email, use the Write tool to create a JSON file at workspace/outbox/<name>.json\n" +
    "Format:\n" +
    '```json\n{"to": "user@example.com", "cc": [], "bcc": [], "subject": "Subject", "body_text": "Email body"}\n```\n' +
    "CRITICAL RULES:\n" +
    "- Do NOT say you need permissions. You HAVE them. Just write the file.\n" +
    "- NEVER paste the email body in your chat response. The user will see it in a preview card.\n" +
    "- Your response should ONLY be a brief confirmation like 'Done! Email drafted to user@example.com for review.'\n" +
    "- Do NOT summarize the email contents. Do NOT include bullet points of what the email covers.\n" +
    "- Keep your response to 1-2 sentences maximum."
  );

  parts.push(
    "# Memory\n" +
    "Your memory file is at memory/MEMORY.md. Read it at the start of each session.\n" +
    "Update it when you learn important facts about contacts, deals, preferences, or decisions."
  );

  parts.push(`Current date: ${new Date().toISOString().split("T")[0]}`);

  const claudeMd = parts.join("\n\n");
  fs.writeFileSync(path.join(dataDir, "CLAUDE.md"), claudeMd);
  logger.info("CLAUDE.md synced to workspace");
}

export function syncMemoryMd(agent: Agent): void {
  const memoryPath = path.join(dataDir, "memory", "MEMORY.md");
  if (agent.memory_md) {
    fs.writeFileSync(memoryPath, agent.memory_md);
  } else if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, "# Memory\n\nNo memories yet.\n");
  }
}

export function readMemoryMd(): string {
  const memoryPath = path.join(dataDir, "memory", "MEMORY.md");
  if (fs.existsSync(memoryPath)) {
    return fs.readFileSync(memoryPath, "utf-8");
  }
  return "";
}

export async function syncMemoryToDb(agentId: number): Promise<void> {
  const memoryMd = readMemoryMd();
  if (memoryMd) {
    await db.updateAgentMemory(agentId, memoryMd);
  }
}

export function syncWorkspace(agent: Agent): void {
  ensureWorkspace();
  syncClaudeMd(agent);
  syncMemoryMd(agent);
}
