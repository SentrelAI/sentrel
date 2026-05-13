import fs from "fs";
import path from "path";
import { config } from "./config.js";
import { host } from "./host/index.js";
import type { Agent } from "./types.js";
import type { AgentSkill } from "./host/host.js";
import { logger } from "./logger.js";
import { scanForInjection } from "./security/injection-scanner.js";

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

// Sprint 6: sync skills from DB to workspace. Called per-job AND from the
// /sync HTTP handler so dashboard changes (install / uninstall / disable)
// take effect immediately. Writes installed skills, removes orphans.
//
// Multi-file (post skills-marketplace sprint): each skill ships an array
// of files (paths relative to the skill dir). SKILL.md is mandatory; helpers
// like helpers/parser.py or schemas/request.json are written alongside.
// Path normalization rejects ../ escapes defensively even though the model
// validates the same on save.
export async function syncSkillsFromDb(agentId: number): Promise<AgentSkill[]> {
  const skills = await host.getAgentSkills(agentId);

  if (skills.length === 0) {
    logger.info("No DB skills found, using legacy file-based skills");
    return [];
  }

  const targetDir = path.join(config.dataDir, "skills");
  fs.mkdirSync(targetDir, { recursive: true });

  const installedSlugs = new Set<string>();
  let writtenSkills = 0;
  let writtenFiles = 0;
  let blocked = 0;

  for (const skill of skills) {
    const filesToWrite = (skill.files && skill.files.length > 0)
      ? skill.files
      : [{ path: "SKILL.md", content: skill.skill_md, file_type: "md" }];

    // Per-file injection scan. If ANY file in the bundle trips the
    // scanner we skip the whole skill — partial installs are confusing.
    const threats = filesToWrite.flatMap((f) =>
      scanForInjection(f.content || "", `skill:${skill.slug}:${f.path}`),
    );
    if (threats.length > 0) {
      logger.warn(`⚠️ Injection threats in skill ${skill.slug}: ${threats.map((t) => t.category).join(", ")} — skipping`);
      blocked++;
      continue;
    }

    installedSlugs.add(skill.slug);
    const skillDir = path.join(targetDir, skill.slug);
    fs.mkdirSync(skillDir, { recursive: true });

    // Wipe the on-disk skill dir before re-writing so files removed in the
    // editor go away. mkdirSync above re-creates it.
    try {
      for (const entry of fs.readdirSync(skillDir, { withFileTypes: true })) {
        const p = path.join(skillDir, entry.name);
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {
      // first install — nothing to wipe
    }

    for (const f of filesToWrite) {
      const safe = sanitizeRelPath(f.path);
      if (!safe) continue; // dropped malicious / empty path
      const filePath = path.join(skillDir, safe);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, f.content ?? "");
      writtenFiles++;
    }
    writtenSkills++;
  }

  // Remove on-disk skill folders that are no longer installed in the DB.
  // Without this, uninstalling a skill leaves a stale SKILL.md on the
  // Machine, the system prompt keeps advertising it, and the agent keeps
  // following its instructions.
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (installedSlugs.has(entry.name)) continue;
      const orphan = path.join(targetDir, entry.name);
      fs.rmSync(orphan, { recursive: true, force: true });
      removed++;
    }
  } catch (err) {
    logger.warn("Skill orphan cleanup failed", { error: (err as Error).message });
  }

  logger.info(
    `Skills synced from DB: ${writtenSkills} skills / ${writtenFiles} files, ${removed} orphans removed${blocked ? `, ${blocked} blocked` : ""} (${skills.map((s) => s.slug).join(", ")})`,
  );
  return skills;
}

// Strip ../ escapes + absolute paths defensively. Server side validates the
// same; this is belt-and-suspenders so a misconfigured / hand-edited skill
// row can't reach outside its own dir.
function sanitizeRelPath(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.split("/").includes("..")) return null;
  if (cleaned.length === 0 || cleaned.length > 200) return null;
  return cleaned;
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
