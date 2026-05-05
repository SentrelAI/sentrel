// Memory consolidation — Item 8.
//
// Two LLM-driven passes that turn the existing MEMORY.md from a dumb append-
// then-truncate buffer into a curated artifact, mirroring Hermes (threshold
// merge) + OpenClaw (pre-rotation flush + dreams audit).
//
//   extractDurableFacts(agent, transcript)
//     Pre-rotation flush: extract 5-10 durable facts (decisions, commitments,
//     people, preferences) from a session's transcript right before the SDK
//     session rotates. Returns one-fact-per-line, no narrative.
//
//   mergeMemory(currentMd)
//     Threshold merge: when MEMORY.md exceeds the budget after a flush,
//     compress related entries, drop superseded ones, return a clean ≤budget
//     version.
//
//   appendDream(dataDir, entry)
//     Append a timestamped audit row to DREAMS.md so a human can see what the
//     agent decided to remember + drop. Bounded to the most recent 20 rows.
//
// All Haiku calls are best-effort: any failure leaves MEMORY.md untouched and
// logs a warning. The agent loop continues normally.

import fs from "fs";
import path from "path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Agent, Message } from "./types.js";

const HAIKU_MODEL = process.env.SUMMARIZE_MODEL || "claude-haiku-4-5-20251001";
const MEMORY_BUDGET = 2200;
const DREAMS_PATH = () => path.join(config.dataDir, "memories", "dreams.md");
const MEMORY_PATH = () => path.join(config.dataDir, "memories", "memory.md");
const DREAMS_KEEP = 20;

async function callHaiku(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const options: Record<string, unknown> = {
    cwd: config.dataDir,
    systemPrompt,
    allowedTools: [],
    permissionMode: "bypassPermissions",
    model: HAIKU_MODEL,
  };
  let out = "";
  try {
    for await (const message of query({ prompt: userPrompt, options: options as any })) {
      const msg = message as any;
      if (msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) out = block.text;
        }
      }
      if (msg.result) out = msg.result;
    }
  } catch (err) {
    logger.warn("Haiku call failed", { error: (err as Error).message });
    return null;
  }
  return out.trim() || null;
}

export async function extractDurableFacts(agent: Agent, messages: Message[]): Promise<string | null> {
  if (messages.length < 5) return null;

  const transcript = messages
    .slice(-60) // last 60 turns max — keep cost bounded
    .map((m) => `${m.role === "user" ? "Contact" : agent.name}: ${m.content}`)
    .join("\n\n");

  const systemPrompt =
    `You are a precise memory curator for ${agent.name}, a ${agent.role}. ` +
    `Given a conversation transcript, extract DURABLE FACTS that ${agent.name} should remember in future sessions.\n\n` +
    `What counts as a durable fact:\n` +
    `- Decisions made (e.g. "Decided to skip Salesforce, use HubSpot instead").\n` +
    `- Commitments to specific people (e.g. "Promised Elie a Zoom for May 4 10am PT").\n` +
    `- Stable facts about people, companies, deals (role, budget, timeline, preferences).\n` +
    `- Preferences expressed by the user (tone, frequency, do/don't).\n\n` +
    `What is NOT durable:\n` +
    `- Greetings, small talk, status pings.\n` +
    `- Tool errors that have since been resolved.\n` +
    `- Already-completed routine work.\n\n` +
    `Rules:\n` +
    `- Output 5-10 lines, one fact per line, no bullets, no preamble, no narrative.\n` +
    `- Each line under 140 chars. Concrete: names, dates, numbers, URLs.\n` +
    `- If nothing durable happened, output the single line: NO_DURABLE_FACTS.\n` +
    `- Never restate facts already obviously known (e.g. "the user is the founder" — they know).`;

  const out = await callHaiku(systemPrompt, `Transcript:\n\n${transcript}`);
  if (!out || out.includes("NO_DURABLE_FACTS")) return null;
  return out;
}

export async function mergeMemory(currentMd: string): Promise<string | null> {
  if (currentMd.length <= MEMORY_BUDGET) return currentMd;

  const systemPrompt =
    `You are a memory compressor. Given a MEMORY.md that has grown over budget, produce a tighter ` +
    `version that fits within ${MEMORY_BUDGET} characters total.\n\n` +
    `Rules:\n` +
    `- MERGE related entries (e.g. three "uses HubSpot" lines → one).\n` +
    `- DROP entries contradicted by newer ones (newer = lower in the file).\n` +
    `- DROP entries about events already resolved/completed.\n` +
    `- KEEP names, dates, numbers, URLs verbatim.\n` +
    `- KEEP a "## Recent" header at the bottom for the freshest 3-5 lines so recency stays accessible.\n` +
    `- Output ONLY the merged MEMORY.md content, no preamble, no explanation, no fences.\n` +
    `- Final length must be ≤ ${MEMORY_BUDGET} chars (you'll be cut if you exceed).`;

  const out = await callHaiku(systemPrompt, `Current MEMORY.md (${currentMd.length} chars):\n\n${currentMd}`);
  if (!out) return null;
  if (out.length > MEMORY_BUDGET) {
    // Haiku ignored the budget — hard-trim from the END (preserves the older
    // pre-recency content the model put first).
    return out.slice(0, MEMORY_BUDGET);
  }
  return out;
}

export function appendDream(entry: { turnRange: string; factsAdded: string; factsBefore: number; factsAfter: number; merged: boolean }): void {
  try {
    fs.mkdirSync(path.dirname(DREAMS_PATH()), { recursive: true });
    const ts = new Date().toISOString();
    const block =
      `## ${ts} — turns ${entry.turnRange}\n` +
      (entry.merged ? `_merged: ${entry.factsBefore}→${entry.factsAfter} chars_\n\n` : `_appended: +${entry.factsAdded.length} chars_\n\n`) +
      entry.factsAdded.trim() + "\n\n";

    let existing = "";
    if (fs.existsSync(DREAMS_PATH())) {
      existing = fs.readFileSync(DREAMS_PATH(), "utf-8");
    }
    // Keep only the most recent DREAMS_KEEP entries (split on `\n## `).
    const all = (block + existing).split(/(?=\n## )/);
    const trimmed = all.slice(0, DREAMS_KEEP).join("");
    fs.writeFileSync(DREAMS_PATH(), trimmed);
  } catch (err) {
    logger.warn("appendDream failed", { error: (err as Error).message });
  }
}

// Composite operation: pull facts → append → merge if over budget → audit.
// Returns the final MEMORY.md so the caller can sync it to DB.
export async function consolidateAtRotation(
  agent: Agent,
  messages: Message[],
  turnRange: string,
): Promise<string | null> {
  const facts = await extractDurableFacts(agent, messages);
  if (!facts) {
    logger.info(`Memory consolidation: no durable facts from turns ${turnRange}`);
    return null;
  }

  let memory = "";
  if (fs.existsSync(MEMORY_PATH())) {
    memory = fs.readFileSync(MEMORY_PATH(), "utf-8");
  }

  const beforeLen = memory.length;
  const appendBlock = `\n\n## ${new Date().toISOString().slice(0, 10)} — session ${turnRange}\n${facts.trim()}\n`;
  let next = (memory + appendBlock).trim() + "\n";

  let merged = false;
  if (next.length > MEMORY_BUDGET) {
    const compressed = await mergeMemory(next);
    if (compressed) {
      next = compressed;
      merged = true;
      logger.info(`Memory consolidation: merged ${beforeLen + appendBlock.length}→${next.length} chars`);
    } else {
      // Merge failed — fall back to pre-append memory + new facts only,
      // hard-truncated at budget. Better to lose old facts than new ones.
      next = (appendBlock + memory).slice(0, MEMORY_BUDGET);
      logger.warn("Memory consolidation: merge failed, fell back to truncate");
    }
  }

  fs.writeFileSync(MEMORY_PATH(), next);
  appendDream({
    turnRange,
    factsAdded: facts,
    factsBefore: beforeLen,
    factsAfter: next.length,
    merged,
  });

  logger.info(`Memory consolidation: ${beforeLen}→${next.length} chars (merged=${merged}, turn_range=${turnRange})`);
  return next;
}
