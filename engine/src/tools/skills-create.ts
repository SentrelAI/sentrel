// skill-creator — agent authors + installs new skills on itself.
//
// Two tools:
//
//   skills.create({ name, slug?, description?, category?, icon?, files })
//     → creates an org-scoped skill_definition row + skill_files; idempotent
//       on slug (re-create with same slug just rewrites the files).
//
//   skills.install_on_me({ slug })
//     → toggles agent_skills.enabled=true for this agent + the given skill,
//       so the agent's next turn already has the new SKILL.md in workspace.
//
// The "agent authoring its own tools" loop pairs with the seeded
// skill-creator SKILL.md which teaches the agent the Anthropic pattern
// (When to use / NOT / Auth / Endpoints / Workflow / Errors / Rules).

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import { railsInternalUrl } from "../host/rails-url.js";

interface SkillsCreatorContext {
  agentId: number;
}

const FileSchema = z.object({
  path: z.string().describe(
    "Relative path within the skill bundle. Always include 'SKILL.md'. " +
    "Other examples: 'examples/draft.json', 'helpers/parse.py', 'schemas/request.json'."
  ),
  content: z.string().describe("Full file contents."),
});

export function buildSkillsCreatorMcpServer(ctx: SkillsCreatorContext) {
  const createTool = tool(
    "create",
    "Author a new skill (org-scoped multi-file bundle). Use when the user asks you to learn a new workflow, codify a new API, or build a skill for a task you'll be doing repeatedly. " +
      "Required: a SKILL.md file in the bundle that teaches future-you how to do the task. Optional: helper files (examples, schemas, scripts). " +
      "Read your installed skill-creator SKILL.md first if you have it — it documents the proper structure (When to use / NOT / Auth / Endpoints / Workflow / Rules sections). " +
      "After create, call skills.install_on_me to use the skill yourself, or tell the user the slug so they can install it on other agents.",
    {
      name: z.string().describe("Human-readable name. Shows up on /skills."),
      slug: z.string().optional().describe(
        "URL identifier. Lowercase letters / digits / hyphens. Omit to derive from name."
      ),
      description: z.string().optional().describe("One-sentence summary for the skill card."),
      category: z.string().optional().describe(
        "common | sales | support | marketing | engineering | content | finance | productivity | generic"
      ),
      icon: z.string().optional().describe("lucide icon name, e.g. 'rss', 'file-text', 'wrench'."),
      files: z.array(FileSchema).describe(
        "Files to ship. MUST include one with path='SKILL.md' carrying the skill instructions."
      ),
    },
    async (args) => {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret) {
        return { content: [{ type: "text", text: "skills.create: ENGINE_API_SECRET not set" }], isError: true };
      }
      if (!args.files.some((f) => f.path === "SKILL.md" && f.content.trim().length > 0)) {
        return {
          content: [{ type: "text", text: "skills.create: every skill must include a non-empty SKILL.md file." }],
          isError: true,
        };
      }
      try {
        const res = await fetch(`${railsInternalUrl()}/api/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Engine-Secret": secret },
          body: JSON.stringify({
            agent_id: ctx.agentId,
            name: args.name,
            slug: args.slug,
            description: args.description,
            category: args.category,
            icon: args.icon,
            files: args.files,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          return {
            content: [{ type: "text", text: `skills.create failed: ${res.status} ${body.slice(0, 240)}` }],
            isError: true,
          };
        }
        const data = (await res.json()) as { slug: string; version: number; files_count: number };
        logger.info("skills.create ok", data);
        return {
          content: [{
            type: "text" as const,
            text:
              `Created skill "${args.name}" with slug ${data.slug} (v${data.version}, ${data.files_count} files).\n` +
              `It's a draft; call skills.install_on_me({ slug: "${data.slug}" }) to start using it yourself, ` +
              `or the user can install it on other agents from /skills/${data.slug}.`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `skills.create network error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  const installTool = tool(
    "install_on_me",
    "Install a skill (by slug) on yourself, so its files land in your workspace and you can call them on the next turn. Use right after skills.create when you authored a skill for the task you're currently doing.",
    {
      slug: z.string().describe("Slug of the skill to install. Must be visible to this org (your own draft or marketplace published)."),
    },
    async (args) => {
      const secret = process.env.ENGINE_API_SECRET;
      if (!secret) {
        return { content: [{ type: "text", text: "skills.install_on_me: ENGINE_API_SECRET not set" }], isError: true };
      }
      try {
        const res = await fetch(`${railsInternalUrl()}/api/skills/install_on_agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Engine-Secret": secret },
          body: JSON.stringify({ agent_id: ctx.agentId, slug: args.slug }),
        });
        if (res.status === 404) {
          return {
            content: [{ type: "text", text: `skills.install_on_me: skill "${args.slug}" not found / not visible to this workspace` }],
            isError: true,
          };
        }
        if (!res.ok) {
          const body = await res.text();
          return {
            content: [{ type: "text", text: `skills.install_on_me failed: ${res.status} ${body.slice(0, 240)}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Installed skill "${args.slug}" on yourself. Files sync on the next turn.` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `skills.install_on_me network error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return createSdkMcpServer({
    name: "skills",
    version: "1.0.0",
    tools: [createTool, installTool],
  });
}
