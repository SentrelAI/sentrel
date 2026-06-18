import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { host } from "./host/index.js";
import { logger } from "./logger.js";
import { scanForInjection } from "./security/injection-scanner.js";
import type { Agent } from "./types.js";

const dataDir = config.dataDir;

// Memory character limit (Hermes-inspired bounded memory).
// Forces the agent to curate instead of dumping everything.
const MEMORY_CHAR_LIMIT = 2200;

// New workspace layout:
// /data/
// ├── soul.md              ← identity rendered from DB
// ├── memories/
// │   ├── memory.md         ← bounded agent-managed notes
// │   └── contacts.md       ← per-contact facts
// ├── skills/               ← synced from DB per-job
// │   └── {slug}/SKILL.md
// ├── workspace/            ← agent's working files
// │   ├── outbox/
// │   ├── inbox/
// │   ├── screenshots/
// │   └── documents/
// └── sessions/

export function ensureWorkspace(): void {
  const dirs = [
    dataDir,
    path.join(dataDir, "memories"),
    path.join(dataDir, "skills"),
    path.join(dataDir, "workspace"),
    path.join(dataDir, "workspace", "outbox"),
    path.join(dataDir, "workspace", "inbox"),
    path.join(dataDir, "workspace", "screenshots"),
    path.join(dataDir, "workspace", "documents"),
    path.join(dataDir, "sessions"),
    path.join(dataDir, "rag"),
    // (hf-cache moved to image-baked /opt/hf-cache — not here anymore)
    // Claude Agent SDK session transcripts — resume uses
    // ~/.claude/projects/<dir>/<sessionId>.jsonl. Stored on /data so the
    // jsonl survives Machine restarts; see ensureClaudeHome below.
    path.join(dataDir, ".claude"),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  ensureClaudeHome();
}

// Symlink $HOME/.claude -> /data/.claude so the SDK's session transcripts
// ride along the persistent volume. Without this, session resume fails
// silently after any Machine restart because the jsonl files are gone.
function ensureClaudeHome(): void {
  // Only relocate the SDK's $HOME/.claude onto the persistent volume in the
  // production container, where dataDir is the absolute /data mount. In local
  // dev (dataDir is a relative path like ./workspace) the developer's real
  // ~/.claude must be left untouched — symlinking it away clobbers it.
  if (!path.isAbsolute(dataDir) || !dataDir.startsWith("/data")) return;

  const home = process.env.HOME || "/home/engine";
  const target = path.join(dataDir, ".claude");
  const link = path.join(home, ".claude");

  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink() && fs.readlinkSync(link) === target) return;
    // Existing non-symlink dir — move its contents into /data/.claude then replace
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(link)) {
        fs.renameSync(path.join(link, entry), path.join(target, entry));
      }
      fs.rmdirSync(link);
    } else {
      fs.unlinkSync(link);
    }
  } catch {
    // Link doesn't exist yet — fall through to create
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "dir");
}

// Render SOUL.md from DB fields — the agent can Read this to reference its identity
export function syncSoulMd(agent: Agent): void {
  const parts: string[] = [];
  if (agent.identity_md?.trim()) parts.push(agent.identity_md.trim());
  if (agent.personality_md?.trim()) parts.push(`## Personality\n${agent.personality_md.trim()}`);
  if (agent.instructions_md?.trim()) parts.push(`## Instructions\n${agent.instructions_md.trim()}`);
  if (agent.organization?.context_md?.trim()) {
    parts.push(`## About ${agent.organization.name || "the organization"}\n${agent.organization.context_md.trim()}`);
  }

  const soulMd = parts.join("\n\n");

  // Phase S P2 — scan for prompt injection before writing
  const threats = scanForInjection(soulMd, "SOUL.md");
  if (threats.length > 0) {
    logger.warn(`⚠️ Injection threats in SOUL.md: ${threats.map(t => `${t.category}: "${t.matchedText}"`).join(", ")}`);
    // Still write the file but log the warning — don't block agent startup
  }

  fs.writeFileSync(path.join(dataDir, "soul.md"), soulMd);
}

export function syncMemoryMd(agent: Agent): void {
  const memoryPath = path.join(dataDir, "memories", "memory.md");
  if (agent.memory_md) {
    fs.writeFileSync(memoryPath, agent.memory_md);
  } else if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, "# Memory\n\nNo memories yet.\n");
  }
}

export function readMemoryMd(): string {
  const memoryPath = path.join(dataDir, "memories", "memory.md");
  if (fs.existsSync(memoryPath)) {
    const content = fs.readFileSync(memoryPath, "utf-8");
    // Enforce bounded memory — truncate if over limit
    if (content.length > MEMORY_CHAR_LIMIT) {
      logger.warn(`Memory exceeds limit (${content.length}/${MEMORY_CHAR_LIMIT} chars), truncating`);
      return content.slice(0, MEMORY_CHAR_LIMIT);
    }
    return content;
  }
  return "";
}

export function getMemoryUsage(): string {
  const content = readMemoryMd();
  const pct = Math.round((content.length / MEMORY_CHAR_LIMIT) * 100);
  return `MEMORY [${pct}% — ${content.length}/${MEMORY_CHAR_LIMIT} chars]`;
}

export async function syncMemoryToDb(agentId: number): Promise<void> {
  const memoryMd = readMemoryMd();
  if (!memoryMd) return;

  // Extra I — scan agent-authored memory for prompt-injection patterns before
  // persisting. Memory is read into the system prompt next turn, so a
  // poisoned memory.md would persist across every future session.
  const threats = scanForInjection(memoryMd, `memory.md (agent ${agentId})`);
  if (threats.length > 0) {
    logger.error(
      `syncMemoryToDb: REJECTED memory write for agent ${agentId} — ${threats.length} threat(s): ` +
      threats.map((t) => t.category).join(", "),
    );
    // Soft fail: don't write, but don't throw — agent's current run continues.
    // Next turn will read the previous clean memory from disk + DB.
    return;
  }

  await host.updateAgentMemory(agentId, memoryMd);
}

export function syncWorkspace(agent: Agent): void {
  ensureWorkspace();
  syncSoulMd(agent);
  syncMemoryMd(agent);
}
