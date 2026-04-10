import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { host } from "./host/index.js";
import type { Agent } from "./types.js";

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
    await host.updateAgentMemory(agentId, memoryMd);
  }
}

export function syncWorkspace(agent: Agent): void {
  ensureWorkspace();
  syncMemoryMd(agent);
}
