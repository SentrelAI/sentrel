import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { scanForInjection } from "../security/injection-scanner.js";

// Origin context — propagated from the user's first inbound through every
// downstream cross-agent delegation so report-backs can find their way home.
export interface TaskOriginContext {
  channel?: string;
  metadata?: Record<string, unknown>;
  conversationId?: number | null;
}

export function buildTasksMcpServer(agentId: number, orgId: number, origin?: TaskOriginContext) {
  const createTaskTool = tool(
    "create_task",
    "Create a task. By default it's assigned to you. To delegate to another agent in the org, pass `assign_to_slug` or `assign_to_role` — they'll be notified and start immediately.",
    {
      title: z.string().describe("Short task title"),
      description: z.string().optional().describe("Detailed description of what needs to be done"),
      instruction: z.string().optional().describe("Specific instruction for when the assignee works on this task"),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Priority level (default: normal)"),
      due_at: z.string().optional().describe("Due date as ISO 8601 string (e.g. '2026-04-20T17:00:00')"),
      assign_to_slug: z.string().optional().describe("Delegate to another agent by slug (e.g. 'marketing-lead', 'sarah'). Leave empty to assign to yourself."),
      assign_to_role: z.string().optional().describe("Delegate by role (e.g. 'Marketing', 'Compliance'). Matches the first agent with that role in the org. Ignored if assign_to_slug is also given."),
    },
    async (args) => {
      try {
        let targetAgentId = agentId;
        let targetDescription = "yourself";

        if (args.assign_to_slug || args.assign_to_role) {
          const target = await host.findAgentBySlugOrRole(orgId, args.assign_to_slug ?? null, args.assign_to_role ?? null);
          if (!target) {
            return {
              content: [{
                type: "text",
                text: `No agent found with slug=${args.assign_to_slug || "-"} or role=${args.assign_to_role || "-"} in this org.`,
              }],
              isError: true,
            };
          }
          if (target.id === agentId) {
            return { content: [{ type: "text", text: `Cannot delegate to yourself. Leave assign_to_* empty to self-assign.` }], isError: true };
          }
          targetAgentId = target.id;
          targetDescription = `${target.name} (${target.role})`;
        }

        const id = await host.createTask(orgId, targetAgentId, args.title, {
          description: args.description,
          instruction: args.instruction,
          priority: args.priority,
          due_at: args.due_at,
          assignedByAgentId: targetAgentId === agentId ? undefined : agentId,
        });
        logger.info(`Task created: ${args.title}`, { id, priority: args.priority || "normal", assignedTo: targetDescription });

        // Cross-agent delegation: wake the assignee's engine immediately via
        // its inbox. Idempotency key = task-assign-<task_id> — double-calls
        // are a BullMQ no-op. Origin (the original user channel) is propagated
        // so the report-back chain can deliver the final answer back to the
        // user without anyone calling a send_* tool explicitly.
        if (targetAgentId !== agentId) {
          const assignerInstruction = [
            args.instruction || args.description || args.title,
            `\n\n(This task was assigned to you by another agent — when you complete it, your response will be reported back to the assigner automatically, who will then deliver it to the user on the channel they originally asked from.)`,
          ].filter(Boolean).join("\n\n");
          await host.publishInboundToAgent(targetAgentId, {
            type: "task_assignment",
            jobId: `task-assign-${id}`,
            orgId,
            origin: origin?.channel
              ? { channel: origin.channel, metadata: origin.metadata || {}, conversationId: origin.conversationId ?? null }
              : undefined,
            payload: {
              taskId: id,
              instruction: assignerInstruction,
            },
          });
        }

        return {
          content: [{
            type: "text",
            text: `Task created (ID: ${id}): "${args.title}" — assigned to ${targetDescription}, ${args.priority || "normal"} priority${args.due_at ? `, due ${args.due_at}` : ""}`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const listTasksTool = tool(
    "list_tasks",
    "List your current tasks. Filter by status to see what's pending, in progress, or done.",
    {
      status: z.enum(["todo", "in_progress", "done", "failed"]).optional().describe("Filter by status. Omit to see all."),
    },
    async (args) => {
      try {
        const tasks = await host.listTasks(agentId, args.status);
        if (tasks.length === 0) {
          return { content: [{ type: "text", text: args.status ? `No ${args.status} tasks.` : "No tasks." }] };
        }
        const formatted = tasks.map((t, i) => {
          const due = t.due_at ? ` — due ${new Date(t.due_at).toLocaleDateString()}` : "";
          return `${i + 1}. [${t.status}] ${t.title} (${t.priority}${due}) — ID: ${t.id}`;
        }).join("\n");
        return { content: [{ type: "text", text: `${tasks.length} task(s):\n\n${formatted}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const updateTaskTool = tool(
    "update_task",
    "Update a task's status, title, priority, or due date. Use to mark tasks as done, change priority, etc.",
    {
      id: z.number().describe("Task ID to update"),
      status: z.enum(["todo", "in_progress", "done", "failed"]).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      due_at: z.string().optional().describe("New due date as ISO 8601 string"),
    },
    async (args) => {
      try {
        const { id, ...updates } = args;
        const cleanUpdates = Object.fromEntries(
          Object.entries(updates).filter(([_, v]) => v !== undefined)
        );
        await host.updateTask(id, cleanUpdates);
        const changes = Object.entries(cleanUpdates).map(([k, v]) => `${k}: ${v}`).join(", ");
        return { content: [{ type: "text", text: `Task ${id} updated: ${changes}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const commentTaskTool = tool(
    "comment_on_task",
    "Add a comment to a task. Use to log progress, notes, or findings.",
    {
      task_id: z.number().describe("Task ID to comment on"),
      content: z.string().describe("Comment text"),
    },
    async (args) => {
      // Extra I — scan agent-authored comments. The comment is mirrored into
      // the task's conversation as a message which gets replayed into future
      // prompts, so a poisoned comment would persist indefinitely.
      const threats = scanForInjection(args.content, `task ${args.task_id} comment`);
      if (threats.length > 0) {
        return {
          content: [{
            type: "text",
            text: `Rejected: comment contains potential prompt-injection patterns (${threats.map((t) => t.category).join(", ")}). Rewrite without those phrases.`,
          }],
          isError: true,
        };
      }
      try {
        const id = await host.addTaskComment(args.task_id, agentId, args.content);
        return { content: [{ type: "text", text: `Comment added to task ${args.task_id}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // Step 5.5 — long-running task primitives.
  //
  // These let a task span days without holding a session open: agent
  // periodically writes progress to the checkpoint JSONB column, asks the user
  // for input (which ends the turn and parks the task), or abandons the task
  // with a reason. Next resumption reads the checkpoint back in prompt-builder.

  const writeCheckpointTool = tool(
    "write_checkpoint",
    "Record progress on a long-running task so you can resume from this point later. JSON-merges into the task's checkpoint field — missing keys are preserved. Call this every 10-20 steps on long tasks.",
    {
      task_id: z.number().describe("Task ID being worked on"),
      checkpoint: z.record(z.string(), z.any()).describe("Arbitrary JSON state — e.g. { processed: 40, total: 100, last_item: 'X' }"),
    },
    async (args) => {
      try {
        await host.writeTaskCheckpoint(args.task_id, args.checkpoint);
        return { content: [{ type: "text", text: `Checkpoint saved for task ${args.task_id}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const askUserTool = tool(
    "ask_user",
    "Ask the task's owner a clarifying question. Sets the task to awaiting_input, posts the question as a comment, and ends your turn. The user's reply will re-engage you on this task.",
    {
      task_id: z.number().describe("Task ID needing clarification"),
      question: z.string().describe("The question to ask"),
    },
    async (args) => {
      try {
        await host.addTaskComment(args.task_id, agentId, args.question);
        await host.updateTask(args.task_id, { status: "awaiting_input" });
        logger.info(`Task ${args.task_id}: awaiting_input (agent asked user)`);
        return { content: [{ type: "text", text: `Question posted to task ${args.task_id}. Task is now awaiting_input; wait for the user's reply before continuing.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const cancelSelfTool = tool(
    "cancel_self",
    "Abandon a task you cannot complete. Use only when blocked on something irrecoverable (e.g. credentials revoked, resource permanently unavailable).",
    {
      task_id: z.number().describe("Task ID to abandon"),
      reason: z.string().describe("Why the task cannot be completed"),
    },
    async (args) => {
      try {
        await host.addTaskComment(args.task_id, agentId, `Task abandoned: ${args.reason}`);
        await host.updateTask(args.task_id, { status: "failed", result: { abandoned: true, reason: args.reason } });
        logger.info(`Task ${args.task_id}: failed (agent abandoned, ${args.reason.slice(0, 80)})`);
        return { content: [{ type: "text", text: `Task ${args.task_id} marked as failed with reason recorded.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "tasks",
    version: "0.1.0",
    tools: [
      createTaskTool,
      listTasksTool,
      updateTaskTool,
      commentTaskTool,
      writeCheckpointTool,
      askUserTool,
      cancelSelfTool,
    ],
  });
}
