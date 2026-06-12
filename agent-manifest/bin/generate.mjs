#!/usr/bin/env node
// agentmanifest generate — interactive wizard that asks everything needed to
// produce a complete agent-bundle/v1, scaffolds the bundle directory
// (agent.yaml + persona files + skill/knowledge stubs), and validates it.
//
// Usage: agentmanifest generate [output-dir]
//
// At any prompt you can type:
//   skip              skip this question
//   remove <section>  drop a whole section, even mid-section or after the
//                     fact — e.g. "remove scheduler", "remove mcp"
//   help              show these commands

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stringify as toYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));

if (!stdin.isTTY) {
  console.error("agentmanifest generate is interactive — run it in a terminal.");
  process.exit(2);
}

// --- Color & motion ------------------------------------------------------------

const useColor = !process.env.NO_COLOR && stdout.isTTY;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const magenta = paint("35");
const cyan = paint("36");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeOut(text, delay = 6) {
  for (const ch of text) {
    stdout.write(ch);
    await sleep(delay);
  }
  stdout.write("\n");
}

async function withSpinner(label, fn) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  if (useColor) stdout.write("\x1b[?25l");
  const timer = setInterval(() => {
    stdout.write(`\r${cyan(frames[i++ % frames.length])} ${label}`);
  }, 80);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    stdout.write(useColor ? "\r\x1b[2K\x1b[?25h" : "\n");
  }
}

// --- Wizard plumbing ---------------------------------------------------------

const SKIPPED = Symbol("skipped");

class SectionRemoved extends Error {
  constructor(key) {
    super(`section removed: ${key}`);
    this.key = key;
  }
}

// User-typed names → manifest section. "remove scheduler" must work.
const SECTION_ALIASES = {
  goal: "goal", mission: "goal", kpis: "goal",
  model: "model",
  channels: "channels", channel: "channels", email: "channels",
  "mailing address": "channels", address: "channels",
  integrations: "integrations", integration: "integrations",
  mcp: "integrations", mcps: "integrations", services: "integrations",
  schedules: "schedules", schedule: "schedules", scheduler: "schedules",
  cron: "schedules", crons: "schedules",
  skills: "skills", skill: "skills",
  permissions: "permissions", permission: "permissions",
};

const rl = createInterface({ input: stdin, output: stdout });

// rl.question() drops lines that arrive while no question is pending, which
// loses input when the user pastes several answers at once. Queue every line
// and let prompts pull from the queue.
const pendingLines = [];
const lineWaiters = [];
rl.on("line", (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line);
  else pendingLines.push(line);
});
function question(prompt) {
  stdout.write(prompt);
  if (pendingLines.length) return Promise.resolve(pendingLines.shift());
  return new Promise((resolve) => lineWaiters.push(resolve));
}

rl.on("close", () => {
  if (!state.done) {
    console.log(`\n${yellow("Aborted — nothing written.")}`);
    process.exit(130);
  }
});

const state = {
  manifest: { spec: "agent-bundle/v1" },
  skills: [],     // [{slug, description}]
  removed: new Set(),
  done: false,
};

let currentSection = null;

const printHelp = () =>
  console.log(
    dim(
      "  Commands: skip — skip this question · remove <section> — drop a\n" +
      "  section (goal, model, channels, integrations, schedules, skills,\n" +
      "  permissions) · help — show this"
    )
  );

function handleCommand(input) {
  const lower = input.toLowerCase();
  if (lower === "help" || lower === "?") {
    printHelp();
    return "handled";
  }
  const m = lower.match(/^(?:never mind,?\s*)?(?:remove|drop|delete)\s+(?:the\s+)?(.+?)\s*$/);
  if (!m) return null;
  const key = SECTION_ALIASES[m[1]];
  if (!key) {
    console.log(yellow(`  Unknown section "${m[1]}". Type "help" for the list.`));
    return "handled";
  }
  delete state.manifest[key];
  if (key === "skills") state.skills = [];
  state.removed.add(key);
  console.log(yellow(`  ✗ Removed ${key} from the spec.`));
  if (key === currentSection) throw new SectionRemoved(key);
  return "handled";
}

async function ask(q, { required = false, def, validate } = {}) {
  for (;;) {
    const hint =
      def !== undefined ? dim(` [${def}]`) : required ? "" : dim(" (skip to omit)");
    const input = (await question(`${q}${hint}\n${cyan("›")} `)).trim();
    if (input && handleCommand(input)) continue;
    if (input.toLowerCase() === "skip" || input === "") {
      if (input === "" && def !== undefined) return def;
      if (required) {
        console.log(yellow("  This one is required."));
        continue;
      }
      return SKIPPED;
    }
    if (validate) {
      const err = validate(input);
      if (err) {
        console.log(yellow(`  ${err}`));
        continue;
      }
    }
    return input;
  }
}

// --- Pickers -------------------------------------------------------------------
// Selects are keyboard-driven (↑↓←→ move, Enter confirms), inquirer-style.
// While a picker is open we detach readline's keypress listener and take the
// keys ourselves, then restore it for the free-text questions.

const OTHER = Symbol("other");

function grabKeypress(onKey) {
  const saved = stdin.listeners("keypress");
  for (const l of saved) stdin.removeListener("keypress", l);
  stdin.on("keypress", onKey);
  return () => {
    stdin.off("keypress", onKey);
    for (const l of saved) stdin.on("keypress", l);
  };
}

// Options are [{label, value, group?}] — when a group is set, a group header
// is printed and items flow in aligned columns (perRow cells per line).
async function pick(title, options, {
  multi = false, defIndex = 0, perRow = 1, colWidth = 18, yesNoKeys = false,
} = {}) {
  console.log(bold(title));
  let cursor = Math.min(Math.max(defIndex, 0), options.length - 1);
  const checked = new Set();
  let rendered = 0;

  const buildLines = () => {
    const out = [];
    let lastGroup;
    let row = [];
    const flush = () => {
      if (row.length) out.push(" " + row.join(""));
      row = [];
    };
    options.forEach((o, i) => {
      if (o.group !== lastGroup) {
        flush();
        if (o.group) out.push(magenta(` ${o.group}`));
        lastGroup = o.group;
      }
      const here = i === cursor;
      const mark = multi ? (checked.has(i) ? green("◉ ") : dim("◯ ")) : "";
      const label = perRow > 1 ? o.label.padEnd(colWidth) : o.label;
      row.push((here ? cyan("▸ ") : "  ") + mark + (here ? cyan(bold(label)) : label));
      if (row.length === perRow) flush();
    });
    flush();
    out.push(dim(
      multi
        ? " ↑↓←→ move · space toggle · enter confirm · s skip"
        : yesNoKeys
          ? " ↑↓ move · y/n · enter confirm · s skip"
          : " ↑↓ move · enter confirm · s skip"
    ));
    return out;
  };

  const draw = () => {
    if (rendered) stdout.write(`\x1b[${rendered}A`);
    const lines = buildLines();
    for (const line of lines) stdout.write(`\x1b[2K${line}\n`);
    rendered = lines.length;
  };

  if (useColor) stdout.write("\x1b[?25l");
  draw();

  const result = await new Promise((resolve) => {
    let restore;
    const done = (val) => {
      restore();
      resolve(val);
    };
    const step = perRow > 1 ? perRow : 1;
    restore = grabKeypress((str, key = {}) => {
      const k = key.name;
      if (key.ctrl && k === "c") {
        stdout.write(useColor ? "\x1b[?25h\n" : "\n");
        console.log(yellow("Aborted — nothing written."));
        process.exit(130);
      }
      if (k === "up") cursor = Math.max(0, cursor - step);
      else if (k === "down") cursor = Math.min(options.length - 1, cursor + step);
      else if (k === "left") cursor = Math.max(0, cursor - 1);
      else if (k === "right") cursor = Math.min(options.length - 1, cursor + 1);
      else if (multi && k === "space") checked.has(cursor) ? checked.delete(cursor) : checked.add(cursor);
      else if (k === "return" || k === "enter") return done(multi ? [...checked].sort((a, b) => a - b) : cursor);
      else if (k === "s" || k === "escape") return done(SKIPPED);
      else if (yesNoKeys && k === "y") return done(0);
      else if (yesNoKeys && k === "n") return done(1);
      else return;
      draw();
    });
  });

  // Collapse the picker into a one-line summary.
  stdout.write(`\x1b[${rendered + 1}A\x1b[0J`);
  if (useColor) stdout.write("\x1b[?25h");
  const summary =
    result === SKIPPED
      ? yellow("skipped")
      : multi
        ? cyan(result.map((i) => options[i].label).join(", ") || "none")
        : cyan(options[result].label);
  console.log(`${green("✔")} ${title} ${dim("·")} ${summary}`);
  return result;
}

async function askYesNo(title, def = false) {
  const r = await pick(title, [{ label: "Yes" }, { label: "No" }], {
    defIndex: def ? 0 : 1,
    yesNoKeys: true,
  });
  if (r === SKIPPED) return false;
  return r === 0;
}

async function askSelect(title, options, { defIndex = 0 } = {}) {
  const r = await pick(title, options, { defIndex });
  return r === SKIPPED ? SKIPPED : options[r].value;
}

// Multi-select picker; with allowCustom an extra "other…" row opens a
// free-text prompt for names not in the list. Returns values ([] on skip).
async function askMultiSelect(title, options, { allowCustom = false, perRow = 1, colWidth = 18 } = {}) {
  const opts = allowCustom
    ? [...options, {
        label: "other… (type your own)",
        value: OTHER,
        group: options.at(-1)?.group ? "Other" : undefined,
      }]
    : options;
  const r = await pick(title, opts, { multi: true, perRow, colWidth });
  if (r === SKIPPED) return [];
  const picked = [];
  for (const i of r) {
    if (opts[i].value === OTHER) {
      const extra = opt(await ask("Other names, comma-separated (e.g. pagerduty, my_crm)"));
      if (!extra) continue;
      for (const tok of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
        const v = tok.toLowerCase().replace(/\s+/g, "_");
        if (!picked.includes(v)) picked.push(v);
      }
    } else if (!picked.includes(opts[i].value)) {
      picked.push(opts[i].value);
    }
  }
  return picked;
}

const SECTION_COUNT = 7;
let sectionIndex = 0;

async function section(key, title, fn) {
  sectionIndex++;
  if (state.removed.has(key)) return;
  currentSection = key;
  const rule = "─".repeat(Math.max(0, 52 - title.length));
  console.log(
    `\n${cyan(bold(`◆ ${title}`))} ${dim(`${rule} ${sectionIndex}/${SECTION_COUNT}`)}`
  );
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof SectionRemoved) || e.key !== key) throw e;
  } finally {
    currentSection = null;
  }
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";

const opt = (v) => (v === SKIPPED ? undefined : v);

// --- Catalogs ------------------------------------------------------------------

// Mirrors the platform's integration catalog (ComposioSupported::CATEGORY_MAP).
const INTEGRATION_CATALOG = [
  ["Sales & CRM", ["apollo", "hubspot", "salesforce", "pipedrive", "linkedin", "outreach", "salesloft", "zoho"]],
  ["Communication", ["gmail", "slack", "outlook", "intercom", "discord", "zoom", "telegram", "whatsapp"]],
  ["Productivity", ["googlecalendar", "googlesheets", "googledrive", "googledocs", "notion", "airtable", "calendly", "asana", "trello", "clickup", "monday"]],
  ["Engineering", ["github", "linear", "jira", "gitlab", "bitbucket", "vercel", "sentry", "digital_ocean"]],
  ["Finance", ["stripe", "quickbooks", "xero"]],
  ["Content & Marketing", ["twitter", "figma", "mailchimp", "typeform", "youtube", "instagram", "wordpress", "webflow", "framer"]],
].flatMap(([group, slugs]) => slugs.map((slug) => ({ label: slug, value: slug, group })));

const CHANNEL_OPTIONS = [
  { label: "slack", value: "slack" },
  { label: "sms", value: "sms" },
  { label: "whatsapp", value: "whatsapp" },
  { label: "telegram", value: "telegram" },
  { label: "discord", value: "discord" },
  { label: "voice (phone calls)", value: "voice" },
];

// --- The questions -------------------------------------------------------------

const BANNER = [
  "╭─────────────────────────────────────────────╮",
  "│   agentmanifest · agent-bundle/v1 wizard    │",
  "╰─────────────────────────────────────────────╯",
];
for (let i = 0; i < BANNER.length; i++) {
  console.log([cyan, magenta, cyan][i % 3](bold(BANNER[i])));
  await sleep(50);
}
await typeOut(dim("Let's build an agent bundle — nothing is written until the end."));
printHelp();

await section("basics", "Basics", async () => {
  state.manifest.name = opt(await ask("Agent name (e.g. Sarah)", { required: true }));
  state.manifest.role = opt(await ask("Role (e.g. Sales Development Rep)"));
  state.manifest.description = opt(await ask("One-sentence description of what it does"));
});

await section("goal", "Goal", async () => {
  const mission = opt(await ask("Mission — what does this agent exist to do?"));
  if (!mission) return;
  const goal = { mission };
  const kpis = [];
  for (;;) {
    const kpi = await ask(
      kpis.length
        ? "Another KPI as metric=target — empty to move on"
        : "KPI as metric=target (e.g. meetings_booked_per_week=5) — empty to move on",
      {
        validate: (v) =>
          /^[a-z][a-z0-9_]*\s*=\s*-?\d+(\.\d+)?$/i.test(v)
            ? null
            : "Format: metric_name=number (e.g. positive_reply_rate_pct=8).",
      }
    );
    if (kpi === SKIPPED) break;
    const [k, v] = kpi.split("=").map((s) => s.trim());
    kpis.push({ [k]: Number(v) });
  }
  if (kpis.length) goal.kpis = kpis;
  goal.definition_of_done = opt(
    await ask('Definition of done — when does the goal count as achieved?')
  );
  if (goal.definition_of_done === undefined) delete goal.definition_of_done;
  state.manifest.goal = goal;
});

await section("model", "Model", async () => {
  const id = await askSelect("Which model should power the agent?", [
    { label: "claude-fable-5 (most capable)", value: "claude-fable-5" },
    { label: "claude-opus-4-8", value: "claude-opus-4-8" },
    { label: "claude-sonnet-4-6 (balanced default)", value: "claude-sonnet-4-6" },
    { label: "claude-haiku-4-5 (fast/cheap)", value: "claude-haiku-4-5" },
    { label: "other / decide at deploy time", value: null },
  ], { defIndex: 2 });
  if (id === SKIPPED) return;
  const model = {};
  if (id) {
    model.provider = "anthropic";
    model.id = id;
  } else {
    const custom = opt(await ask("Model id (provider will be asked next)"));
    if (custom) {
      model.id = custom;
      model.provider = opt(await ask("Provider", { def: "anthropic" }));
    }
  }
  if (model.id) {
    model.temperature = 0;
    console.log(dim("  temperature: 0 (deterministic — edit agent.yaml to change)"));
  }
  if (Object.keys(model).length) state.manifest.model = model;
});

await section("channels", "Channels", async () => {
  const channels = [];
  if (await askYesNo("Does the agent need its own mailing address (email channel)?", true)) {
    const channel = { type: "email" };
    const hint = opt(
      await ask('Address hint (e.g. "sarah@{{company_domain}}")')
    );
    if (hint) channel.config = { address_hint: hint };
    channels.push(channel);
  }
  const picked = await askMultiSelect(
    "Which other channels does the agent need?",
    CHANNEL_OPTIONS,
    { allowCustom: true }
  );
  for (const type of picked) channels.push({ type });
  if (channels.length) state.manifest.channels = channels;
});

await section("integrations", "Integrations & MCP servers", async () => {
  const integrations = [];

  const picked = await askMultiSelect(
    "What integrations / MCP servers does the agent need?",
    INTEGRATION_CATALOG,
    { allowCustom: true, perRow: 4, colWidth: 16 }
  );
  for (const service of picked) {
    const entry = { service };
    const why = opt(await ask(`Why ${service}?`));
    if (why) entry.why = why;
    integrations.push(entry);
  }

  for (;;) {
    const list = opt(
      await ask(
        "Any-of group — user picks ONE alternative at deploy. Comma-separated (e.g. googlecalendar, outlook, calcom) — empty to move on",
        {
          validate: (v) =>
            v.split(",").map((s) => s.trim()).filter(Boolean).length >= 2
              ? null
              : "Need at least two alternatives.",
        }
      )
    );
    if (!list) break;
    const entry = { any_of: list.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) };
    const why = opt(await ask("Why this group?"));
    if (why) entry.why = why;
    integrations.push(entry);
  }

  for (;;) {
    const name = opt(
      await ask(
        integrations.some((i) => i.type === "mcp")
          ? "Another custom MCP server name — empty to move on"
          : "Custom MCP server not listed above, name only (e.g. linkedin) — empty to move on"
      )
    );
    if (!name) break;
    const entry = { type: "mcp", name: name.toLowerCase() };
    const transportKind = await askSelect("Transport?", [
      { label: "http", value: "http" },
      { label: "sse", value: "sse" },
      { label: "stdio (local command)", value: "stdio" },
    ], { defIndex: 0 });
    if (transportKind !== SKIPPED) {
      const transport = { kind: transportKind };
      if (transportKind === "stdio") {
        const command = opt(await ask("Command to launch the server", { required: true }));
        transport.command = command;
      } else {
        const url = opt(
          await ask("Server URL", {
            required: true,
            validate: (v) => (/^https?:\/\/\S+$/.test(v) ? null : "A full http(s) URL."),
          })
        );
        transport.url = url;
      }
      entry.transport = transport;
    }
    const why = opt(await ask(`Why ${name}?`));
    if (why) entry.why = why;
    integrations.push(entry);
  }

  if (integrations.length) state.manifest.integrations = integrations;
});

// No questions for schedules — every agent ships with an hourly heartbeat.
// Type "remove schedules" at any prompt to drop it.
if (!state.removed.has("schedules")) {
  state.manifest.schedules = [{
    name: "Heartbeat",
    cron: "0 * * * *",
    timezone: "UTC",
    instruction:
      "Hourly heartbeat: review open threads and pending work, advance the goal, and flag anything that needs a human.",
  }];
  console.log(dim('\n  ⏱ Added an hourly heartbeat schedule ("remove schedules" drops it).'));
}

await section("skills", "Skills", async () => {
  for (;;) {
    const name = opt(
      await ask(
        state.skills.length
          ? "Another custom skill name — empty to move on"
          : "Custom skill to ship with the bundle (e.g. follow-up-protocol) — empty for none"
      )
    );
    if (!name) break;
    const slug = slugify(name);
    const description = opt(await ask(`One line: when should the agent use ${slug}?`));
    state.skills.push({ slug, description });
  }
  if (state.skills.length)
    state.manifest.skills = state.skills.map((s) => `./skills/${s.slug}`);
});

await section("permissions", "Permissions", async () => {
  const permissions = {};
  console.log(
    `${bold("Levels:")} ${green("auto")} ${dim("— acts on its own")} · ` +
    `${yellow("ask")} ${dim("— a human approves each time")} · ` +
    `${red("block")} ${dim("— never allowed")}`
  );
  const hasEmail = (state.manifest.channels ?? []).some((c) => c.type === "email");
  const suggested = hasEmail
    ? { send_email: "ask", reply_email: "auto", delete_data: "block" }
    : { delete_data: "block" };
  const MEANINGS = {
    send_email: "every new outbound email waits for your approval",
    reply_email: "replies in an existing thread go out on their own",
    delete_data: "the agent can never delete data",
  };
  console.log(bold("\nSuggested defaults:"));
  for (const [k, v] of Object.entries(suggested)) {
    const color = v === "auto" ? green : v === "ask" ? yellow : red;
    console.log(`  ${k.padEnd(14)} ${color(v.padEnd(6))} ${dim(MEANINGS[k] ?? "")}`);
  }
  if (await askYesNo("Start from these?", true)) Object.assign(permissions, suggested);
  for (;;) {
    const entry = opt(
      await ask("Permission as action=level (block|ask|auto), e.g. book_meeting=auto — empty to finish", {
        validate: (v) =>
          /^[a-z][a-z0-9_]*\s*=\s*(block|ask|auto)$/i.test(v)
            ? null
            : "Format: action_name=block|ask|auto.",
      })
    );
    if (!entry) break;
    const [k, v] = entry.split("=").map((s) => s.trim().toLowerCase());
    permissions[k] = v;
  }
  if (Object.keys(permissions).length) state.manifest.permissions = permissions;
});

// --- Review & write ------------------------------------------------------------

const m = state.manifest;
m.persona = {
  personality: "./personality.md",
  identity: "./identity.md",
  instructions: "./instructions.md",
};

// agent.yaml in the canonical example order, skipping empty sections.
const ordered = {};
for (const k of [
  "spec", "name", "role", "description", "goal", "persona", "model",
  "skills", "knowledge", "channels", "schedules", "integrations",
  "secrets", "permissions",
]) {
  if (m[k] !== undefined) ordered[k] = m[k];
}
const manifestYaml = toYaml(ordered, { lineWidth: 78 });

console.log(`\n${cyan(bold("◆ Review"))} ${dim("─".repeat(52))}\n`);
console.log(manifestYaml.replace(/^(\s*)([\w-]+):/gm, (_, ws, key) => `${ws}${cyan(key)}:`));

const defaultDir = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== "generate")
  ?? slugify(m.name);
const outDirAnswer = await ask("Write bundle to directory", { def: defaultDir });
const outDir = resolve(outDirAnswer === SKIPPED ? defaultDir : outDirAnswer);

if (existsSync(outDir) && readdirSync(outDir).length > 0) {
  if (!(await askYesNo(`${outDir} exists and is not empty — write into it anyway?`))) {
    console.log(yellow("Aborted — nothing written."));
    state.done = true;
    rl.close();
    process.exit(1);
  }
}

const write = async (rel, content) => {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log(`  ${green("+")} ${rel}`);
  await sleep(40);
};

const name = m.name;
const role = m.role ?? "Assistant";

console.log(`\n${bold(`Scaffolding ${outDir}`)}`);
await write("agent.yaml", manifestYaml);

await write(
  "personality.md",
  `# Personality

I'm ${name}. <!-- TODO: how does ${name} sound? Tone, brevity, voice. -->

## How I sound

- **Concise.** <!-- TODO -->
- **Concrete.** <!-- TODO -->

## How I handle ambiguity

<!-- TODO: what does ${name} do when a request is unclear? -->
`
);

await write(
  "identity.md",
  `# Identity

I am ${name}, the ${role} at {{company_name}}.

${m.description ?? "<!-- TODO: what does this agent own, end to end? -->"}

- **My job:** ${m.goal?.mission ?? "<!-- TODO -->"}
- **My team:** I work for {{user_name}}.
- **Transparency:** I am an AI assistant. I never pretend otherwise when
  asked directly.

What I refuse to do:
<!-- TODO: hard lines this agent never crosses. -->
`
);

await write(
  "instructions.md",
  `# How I work

<!-- TODO: the operating manual — workflows, hard rules, edge cases.
Numbers and policies that change often belong in knowledge/ files, which
win over this file when they disagree. -->

## Hard rules (no exceptions)

1. <!-- TODO -->
`
);

for (const skill of state.skills) {
  await write(
    `skills/${skill.slug}/SKILL.md`,
    `---
name: ${skill.slug}
description: ${skill.description ?? `Use when … <!-- TODO: trigger conditions for ${skill.slug} -->`}
---

# ${skill.slug}

<!-- TODO: the step-by-step procedure for this skill. -->
`
  );
}

await write(
  "README.md",
  `# ${name} — ${role}

${m.description ?? ""}

An [agent-bundle/v1](https://alchemy.scribemd.ai/schemas/agent-bundle.v1.schema.json)
generated with \`npx @manifestagent/agentmanifest generate\`.

Validate after editing:

\`\`\`sh
npx @manifestagent/agentmanifest validate .
\`\`\`

Deploy when ready — validates, uploads, and opens the
[double.md](https://www.double.md) deploy wizard in your browser:

\`\`\`sh
npx @manifestagent/agentmanifest deploy .
\`\`\`

Search for \`TODO\` — the persona files are stubs until you fill them in.
`
);

// --- Validate what we just wrote ------------------------------------------------

console.log();
const result = await withSpinner("Validating bundle…", () =>
  new Promise((res) => {
    const child = spawn(process.execPath, [join(here, "validate.mjs"), outDir]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => res({ code, out }));
  })
);
if (result.out.trim()) console.log(result.out.trimEnd());
console.log(
  result.code === 0
    ? green(bold(`\n✔ Bundle ready at ${outDir}`))
    : red(bold("\n✘ Validation failed — fix the bundle and re-run `npx @manifestagent/agentmanifest validate`."))
);
state.done = true;
rl.close();
process.exit(result.code ?? 0);
