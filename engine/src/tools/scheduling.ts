import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { host } from "../host/index.js";
import { logger } from "../logger.js";

// Step 5 — scheduling tools write to the unified `scheduled_work` table.
// The work-scheduler polls that table and registers BullMQ jobs. No direct
// BullMQ interaction from the tool layer — single source of truth in Postgres.

export function buildSchedulingMcpServer(agentId: number, orgId: number, currentChannel?: string, channelMeta?: Record<string, unknown>) {
  const scheduleTool = tool(
    "schedule_task",
    "Create a recurring scheduled task with a cron expression. Use for things like " +
      "'send a weekly report every Monday at 9am' or 'check for new leads every hour'. " +
      "The instruction is what you will execute each time the schedule fires.",
    {
      name: z.string().describe("Short name for the schedule (e.g. 'Weekly outreach report')"),
      instruction: z.string().describe("What to do each time — this is the prompt you'll receive"),
      cron_expression: z.string().describe(
        "Standard 5-field cron: minute hour day-of-month month day-of-week. " +
        "Examples: '0 9 * * 1' = Monday 9am, '0 */2 * * *' = every 2 hours, " +
        "'30 8 * * 1-5' = weekdays 8:30am"
      ),
      timezone: z.string().optional().describe("Timezone (default: UTC). Examples: America/Los_Angeles, America/New_York"),
    },
    async (args) => {
      try {
        const id = await host.createScheduledWork(orgId, agentId, {
          mode: "cron",
          name: args.name,
          instruction: args.instruction,
          cron_expression: args.cron_expression,
          timezone: args.timezone || "UTC",
          fire_at: null,
          interval_seconds: null,
          active: true,
          payload_extra: { channel: currentChannel, channelMeta },
        });
        logger.info(`Scheduled cron created: ${args.name} (${args.cron_expression})`, { id });
        return {
          content: [{ type: "text", text: `Scheduled task created (ID: ${id}): "${args.name}" — runs on cron: ${args.cron_expression} (${args.timezone || "UTC"})` }],
        };
      } catch (err) {
        logger.error("schedule_task failed", { error: (err as Error).message });
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const reminderTool = tool(
    "set_reminder",
    "Set a one-time reminder at a specific date/time. " +
      "Use for things like 'remind me to follow up with Bob on Friday at 2pm'.",
    {
      name: z.string().describe("What to remind about (e.g. 'Follow up with Bob')"),
      instruction: z.string().describe("The full instruction to execute when the reminder fires"),
      datetime: z.string().describe(
        "ISO 8601 datetime string for when to fire: '2026-04-18T14:00:00'. " +
        "Convert natural language to this format using the current date provided in your system prompt."
      ),
      timezone: z.string().optional().describe("Timezone (default: UTC)"),
    },
    async (args) => {
      try {
        let dtStr = args.datetime;
        if (!dtStr.endsWith("Z") && !dtStr.includes("+") && !/\d{2}:\d{2}$/.test(dtStr.slice(-5))) {
          dtStr += "Z";
        }
        const dt = new Date(dtStr);
        if (isNaN(dt.getTime())) {
          return { content: [{ type: "text", text: `Invalid datetime: ${args.datetime}` }], isError: true };
        }
        if (dt.getTime() < Date.now()) {
          return { content: [{ type: "text", text: `Cannot set reminder in the past: ${args.datetime}` }], isError: true };
        }

        const id = await host.createScheduledWork(orgId, agentId, {
          mode: "once",
          name: args.name,
          instruction: `REMINDER: ${args.name}\n\n${args.instruction}\n\nSend this reminder to the user on ${currentChannel || "their channel"}.`,
          cron_expression: null,
          timezone: args.timezone || "UTC",
          fire_at: dt.toISOString(),
          interval_seconds: null,
          active: true,
          payload_extra: { channel: currentChannel, channelMeta },
        });

        const minutesUntil = Math.round((dt.getTime() - Date.now()) / 60000);
        logger.info(`Reminder created: ${args.name} in ${minutesUntil}min`, { id });
        return {
          content: [{ type: "text", text: `Reminder set: "${args.name}" — fires at ${args.datetime} (in ~${minutesUntil} minutes)` }],
        };
      } catch (err) {
        logger.error("set_reminder failed", { error: (err as Error).message });
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const listSchedulesTool = tool(
    "list_schedules",
    "List all your active scheduled tasks, reminders, and intervals.",
    {},
    async () => {
      try {
        const items = await host.getScheduledWork(agentId);
        if (items.length === 0) {
          return { content: [{ type: "text", text: "No active schedules." }] };
        }
        const formatted = items.map((t, i) => {
          const meta = t.mode === "cron" ? `cron: ${t.cron_expression} (${t.timezone})`
            : t.mode === "once" ? `once at ${t.fire_at}`
            : `every ${t.interval_seconds}s`;
          return `${i + 1}. [${t.mode}] ${t.name} — ${meta}\n   Instruction: ${t.instruction.slice(0, 100)}`;
        }).join("\n\n");
        return { content: [{ type: "text", text: `${items.length} active schedule(s):\n\n${formatted}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const deleteScheduleTool = tool(
    "delete_schedule",
    "Delete a scheduled task, reminder, or interval by its ID.",
    { id: z.number().describe("The schedule ID to delete") },
    async (args) => {
      try {
        await host.deleteScheduledWork(args.id);
        return { content: [{ type: "text", text: `Schedule ${args.id} deleted.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  return createSdkMcpServer({
    name: "scheduling",
    version: "0.2.0",
    tools: [scheduleTool, reminderTool, listSchedulesTool, deleteScheduleTool],
  });
}
