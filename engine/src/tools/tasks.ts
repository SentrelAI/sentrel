import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "crypto";
import { host } from "../host/index.js";
import { logger } from "../logger.js";
import { scanForInjection } from "../security/injection-scanner.js";
import { deliverToOrigin, type Origin } from "../channels/origin-delivery.js";

// Origin context — propagated from the user's first inbound through every
// downstream cross-agent delegation so report-backs can find their way home.
export interface TaskOriginContext {
  channel?: string;
  metadata?: Record<string, unknown>;
  conversationId?: number | null;
}

// Helper — coerce a TaskOriginContext into the canonical Origin shape used by
// channel renderers. Returns undefined if the context lacks a channel.
function asOrigin(ctx?: TaskOriginContext): Origin | undefined {
  if (!ctx?.channel) return undefined;
  return { channel: ctx.channel, metadata: ctx.metadata || {}, conversationId: ctx.conversationId ?? null };
}

// currentTaskId is the task this agent is presently processing (if any).
// Used as parent_task_id on any sub-task created via create_task / ask_agent /
// escalate so cancellation propagates correctly.
export function buildTasksMcpServer(agentId: number, orgId: number, origin?: TaskOriginContext, currentTaskId?: number) {
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
          parentTaskId: targetAgentId === agentId ? undefined : currentTaskId,
        });
        logger.info(`Task created: ${args.title}`, { id, priority: args.priority || "normal", assignedTo: targetDescription });

        // Cross-agent delegation: wake the assignee's engine immediately via
        // its inbox. Idempotency key = task-assign-<task_id> — double-calls
        // are a BullMQ no-op. Origin (the original user channel) is propagated
        // so the report-back chain can deliver the final answer back to the
        // user without anyone calling a send_* tool explicitly.
        if (targetAgentId !== agentId) {
          const createdTask = await host.getTask(id);
          const assignerInstruction = [
            args.instruction || args.description || args.title,
            `\n\n(This task was assigned to you by another agent — when you complete it, your response will be reported back to the assigner automatically, who will then deliver it to the user on the channel they originally asked from.)`,
          ].filter(Boolean).join("\n\n");
          await host.publishInboundToAgent(targetAgentId, {
            type: "task_assignment",
            jobId: `task-assign-${id}`,
            orgId,
            conversationId: createdTask?.conversation_id ?? null,
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

  // ── Multi-agent collaboration primitives ──
  // (1) progress_update: live status pings without ending the turn.
  // (2) ask_agent: question another agent and wait for their reply.
  // (3) escalate: pause a task and ping a manager with a blocker.

  const progressUpdateTool = tool(
    "progress_update",
    "Post a progress update on a long-running task without ending your turn. Writes a comment to the task AND, if the user is watching this work on a channel (Telegram/web/etc.), sends them a quick status note. Call this every few minutes on tasks that take longer than 5 minutes — keeps the user informed without making them ask.",
    {
      task_id: z.number().describe("Task ID being worked on"),
      message: z.string().describe("Short status — what you're doing now and roughly how far along you are. One or two sentences."),
    },
    async (args) => {
      try {
        await host.addTaskComment(args.task_id, agentId, `[progress] ${args.message}`);
        const o = asOrigin(origin);
        if (o) {
          // Best-effort live ping; failures don't abort the agent loop.
          await deliverToOrigin(o, `🛠️  ${args.message}`).catch((err) => {
            logger.warn("progress_update: origin delivery failed", { error: (err as Error).message });
          });
        }
        return { content: [{ type: "text", text: `Progress update posted on task ${args.task_id}.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const askAgentTool = tool(
    "ask_agent",
    "Ask another agent in the org a clarifying question and pause until they answer. Use when you need expertise or info from a teammate (e.g. SDR asks Marketing 'should we emphasize price or specialty?'). Internally creates a sub-task assigned to them — when they finish, their answer is reported back to you and you'll be re-engaged on the parent task.",
    {
      target_slug: z.string().optional().describe("Teammate by slug (e.g. 'marketing-lead', 'casper'). Either slug OR role required."),
      target_role: z.string().optional().describe("Teammate by role (e.g. 'Marketing', 'CEO'). Used if slug not given."),
      question: z.string().describe("The question to ask. Be specific — they don't have your context."),
      task_id: z.number().optional().describe("Parent task ID, if this question relates to one. Sets parent to awaiting_input."),
      context: z.string().optional().describe("Optional context: what you're working on, what you've tried, what you need to decide."),
    },
    async (args) => {
      try {
        if (!args.target_slug && !args.target_role) {
          return { content: [{ type: "text", text: "Provide target_slug or target_role." }], isError: true };
        }
        const target = await host.findAgentBySlugOrRole(orgId, args.target_slug ?? null, args.target_role ?? null);
        if (!target) {
          return { content: [{ type: "text", text: `No teammate found with slug=${args.target_slug || "-"} or role=${args.target_role || "-"}.` }], isError: true };
        }
        if (target.id === agentId) {
          return { content: [{ type: "text", text: "Cannot ask yourself." }], isError: true };
        }

        const title = `Question from ${target.name === target.role ? "a teammate" : agentId}`.slice(0, 100);
        const instruction = [
          `Question:\n${args.question}`,
          args.context ? `Context:\n${args.context}` : null,
          `Reply with your answer — it will be reported back to the asker automatically.`,
        ].filter(Boolean).join("\n\n");

        const newTaskId = await host.createTask(orgId, target.id, `Q: ${args.question.slice(0, 80)}`, {
          description: args.context,
          instruction,
          priority: "high",
          assignedByAgentId: agentId,
          parentTaskId: args.task_id ?? currentTaskId,
        });
        const createdTask = await host.getTask(newTaskId);

        await host.publishInboundToAgent(target.id, {
          type: "task_assignment",
          jobId: `agent-question-${newTaskId}`,
          orgId,
          conversationId: createdTask?.conversation_id ?? null,
          origin: asOrigin(origin),
          payload: {
            taskId: newTaskId,
            instruction,
          },
        });

        if (args.task_id) {
          await host.addTaskComment(args.task_id, agentId, `[ask] Asked ${target.name} (${target.role}): ${args.question}`);
          await host.updateTask(args.task_id, { status: "awaiting_input" });
        }

        return {
          content: [{
            type: "text",
            text: `Question sent to ${target.name} (${target.role}). Their reply will re-engage you on this task. Wait — do not continue with the original work until they answer.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const escalateTool = tool(
    "escalate",
    "Escalate a blocker to your manager (or a specified role). Use when something is preventing you from completing a task and you can't resolve it yourself: missing access, ambiguous direction, ethical concern, scope change. Pauses the task and pings the manager.",
    {
      task_id: z.number().describe("Task ID that's blocked"),
      blocker: z.string().describe("What's blocking you. Be concrete — what did you try, what failed, what do you need."),
      escalate_to_role: z.string().optional().describe("Specific role to escalate to (e.g. 'CEO'). Defaults to your manager."),
    },
    async (args) => {
      try {
        // Find the manager. If escalate_to_role is given, route there; else
        // look up agent's manager_id from DB.
        let target: { id: number; name: string; role: string } | null = null;
        if (args.escalate_to_role) {
          target = await host.findAgentBySlugOrRole(orgId, null, args.escalate_to_role);
        } else {
          const me = await host.getAgent(String(agentId));
          if (me.manager_id) {
            const allTeammates = await host.getTeammates(orgId, agentId);
            const manager = allTeammates.find((t) => t.id === me.manager_id);
            if (manager) target = { id: manager.id, name: manager.name, role: manager.role };
          }
        }
        if (!target) {
          return {
            content: [{
              type: "text",
              text: "No manager found to escalate to. The task is now awaiting_input — the user will see the blocker on the dashboard.",
            }],
          };
        }

        await host.addTaskComment(args.task_id, agentId, `🚨 ESCALATION: ${args.blocker}`);
        await host.updateTask(args.task_id, { status: "awaiting_input" });

        const escalationTaskId = await host.createTask(orgId, target.id, `Escalation: blocker on task ${args.task_id}`, {
          description: args.blocker,
          instruction: `One of your teammates is blocked on task ${args.task_id} and needs your help.\n\nBlocker:\n${args.blocker}\n\nDecide what to do: unblock them with a directive, reassign, or cancel. Reply with what you've decided — it will be reported back automatically.`,
          priority: "urgent",
          assignedByAgentId: agentId,
          parentTaskId: args.task_id,
        });
        const createdTask = await host.getTask(escalationTaskId);

        await host.publishInboundToAgent(target.id, {
          type: "task_assignment",
          jobId: `escalation-${escalationTaskId}`,
          orgId,
          conversationId: createdTask?.conversation_id ?? null,
          origin: asOrigin(origin),
          payload: {
            taskId: escalationTaskId,
            instruction: `URGENT — escalation from a teammate.\n\nTask ${args.task_id} is blocked.\n\nBlocker:\n${args.blocker}`,
          },
        });

        return {
          content: [{
            type: "text",
            text: `Escalated to ${target.name} (${target.role}). Task ${args.task_id} is now awaiting_input. They'll get back to you.`,
          }],
        };
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
      progressUpdateTool,
      askAgentTool,
      escalateTool,
    ],
  });
}
