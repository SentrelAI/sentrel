import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { host } from "./host/index.js";
import type { Agent } from "./types.js";
import type { AgentSkill } from "./host/host.js";
import { logger } from "./logger.js";

// Role → built-in skill slugs to auto-install for new agents
const ROLE_DEFAULT_SKILLS: Record<string, string[]> = {
  SDR: ["send-email", "sdr-outreach", "sdr-prospecting", "web-search", "stealth-browser", "send-files"],
  "Content Writer": ["content-writing", "social-media", "web-search", "send-files"],
  Content: ["content-writing", "social-media", "web-search", "send-files"],
  Finance: ["expense-tracking", "send-email", "send-files"],
  Engineer: ["code-review", "web-search", "send-files"],
  Engineering: ["code-review", "web-search", "send-files"],
  Support: ["send-email", "web-search", "send-files"],
};

// Legacy: provision skills from static files (fallback if DB has no skills)
export function provisionSkills(agent: Agent): void {
  const targetDir = path.join(config.dataDir, "skills");
  const sourceDir = path.join(import.meta.dir, "..", "skills");

  if (!fs.existsSync(sourceDir)) {
    logger.warn("Skills source directory not found, skipping legacy provision");
    return;
  }

  // Copy common + role-specific skills from static files
  copySkillsIfExists(path.join(sourceDir, "common"), targetDir);
  const roleKey = agent.role === "SDR" ? "sdr"
    : agent.role === "Content" || agent.role === "Content Writer" ? "content"
    : agent.role === "Engineer" || agent.role === "Engineering" ? "engineering"
    : agent.role === "Finance" ? "finance"
    : "common";
  if (roleKey !== "common") {
    copySkillsIfExists(path.join(sourceDir, roleKey), targetDir);
  }

  logger.info(`Skills provisioned for role: ${agent.role}`);
}

// Sprint 6: sync skills from DB to workspace. Called per-job so changes
// from the dashboard take effect immediately (no engine restart needed).
export async function syncSkillsFromDb(agentId: number): Promise<AgentSkill[]> {
  const skills = await host.getAgentSkills(agentId);

  if (skills.length === 0) {
    logger.info("No DB skills found, using legacy file-based skills");
    return [];
  }

  const targetDir = path.join(config.dataDir, "skills");
  fs.mkdirSync(targetDir, { recursive: true });

  for (const skill of skills) {
    const skillDir = path.join(targetDir, skill.slug);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skill.skill_md);
  }

  logger.info(`Skills synced from DB: ${skills.map((s) => s.slug).join(", ")}`);
  return skills;
}

// Get default skill slugs for a role (used when creating a new agent)
export function getDefaultSkillsForRole(role: string): string[] {
  return ROLE_DEFAULT_SKILLS[role] || ROLE_DEFAULT_SKILLS.Support || [];
}

function copySkillsIfExists(srcDir: string, targetDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const src = path.join(srcDir, entry.name);
      const dest = path.join(targetDir, entry.name);
      fs.cpSync(src, dest, { recursive: true, force: true });
    }
  }
}
