// Core validation for an Agent Bundle directory (agent-bundle/v1):
// schema, referenced files, and secret-value scan. Shared by
// `agentmanifest validate` (reporting) and `agentmanifest deploy`
// (gate before upload).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "schema", "agent-bundle.v1.schema.json");

// Platform-provided tokens — always available for {{substitution}} without
// being declared as an input. Keep in sync with double.md's substitution layer.
// Must mirror AgentBundles::Deployer#substitution_context exactly.
const BUILTIN_TOKENS = new Set([
  "agent_name",
  "company_name",
  "company_domain",
  "user_name",
  "user_email",
  "role",
]);

// Build a JSON Schema for one input's value from its declared type + rules,
// so a single ajv pass can check that `default` is well-typed.
function inputValueSchema(input) {
  const v = input.validate ?? {};
  switch (input.type ?? "text") {
    case "number":
      return { type: "number", ...(v.min != null && { minimum: v.min }), ...(v.max != null && { maximum: v.max }) };
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { enum: input.options ?? [] };
    case "list":
      return {
        type: "array",
        items: { type: "string" },
        ...(v.min_items != null && { minItems: v.min_items }),
        ...(v.max_items != null && { maxItems: v.max_items }),
      };
    case "text":
    default:
      return {
        type: "string",
        ...(v.pattern != null && { pattern: v.pattern }),
        ...(v.min_length != null && { minLength: v.min_length }),
        ...(v.max_length != null && { maxLength: v.max_length }),
      };
  }
}

// → { valid: boolean, errors: string[], warnings: string[] }
export function validateBundle(bundleDir) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // --- 1. Manifest exists and parses ---------------------------------------
  const manifestPath = join(bundleDir, "agent.yaml");
  let manifest;
  if (!existsSync(manifestPath)) {
    fail("agent.yaml: not found at bundle root");
  } else {
    try {
      manifest = parseYaml(readFileSync(manifestPath, "utf8"));
    } catch (e) {
      fail(`agent.yaml: YAML parse error — ${e.message}`);
    }
  }

  if (manifest) {
    // --- 2. Schema validation -----------------------------------------------
    const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
    if (!validate(manifest)) {
      for (const e of validate.errors) {
        fail(`agent.yaml: ${e.instancePath || "(root)"} ${e.message}`);
      }
    }

    // --- 3. Referenced files exist --------------------------------------------
    const mustExist = (rel, label, requireFile) => {
      if (typeof rel !== "string") return;
      const p = join(bundleDir, rel);
      if (!existsSync(p)) return fail(`agent.yaml: ${label} → ${rel} not found`);
      if (requireFile && !existsSync(join(p, requireFile))) {
        fail(`agent.yaml: ${label} → ${rel}/${requireFile} not found`);
      }
    };

    for (const k of ["personality", "identity", "instructions"]) {
      mustExist(manifest.persona?.[k], `persona.${k}`);
    }
    (manifest.skills ?? []).forEach((s, i) => {
      const p = join(bundleDir, String(s));
      if (existsSync(p) && statSync(p).isDirectory()) {
        mustExist(s, `skills[${i}]`, "SKILL.md");
      } else {
        mustExist(s, `skills[${i}]`);
      }
    });
    (manifest.knowledge ?? []).forEach((k, i) =>
      mustExist(k?.path, `knowledge[${i}].path`)
    );

    // Convention: personality.md is required even when persona is omitted.
    if (!manifest.persona?.personality && !existsSync(join(bundleDir, "personality.md"))) {
      fail("bundle: personality.md missing (no persona.personality override given)");
    }

    // --- 4. Secret-value scan (authoritative, case-insensitive) --------------
    const SECRET_KEY = /(token|secret|password|api[-_]?key|private[-_]?key)/i;
    const ALLOWED_HINTS = new Set(["address_hint", "name_hint"]);
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (SECRET_KEY.test(k) && !ALLOWED_HINTS.has(k) && typeof v === "string") {
            fail(`agent.yaml: ${path}.${k} looks like a secret VALUE — bundles may only declare secret names under secrets[]`);
          }
          walk(v, `${path}.${k}`);
        }
      }
    };
    // secrets[].name is the sanctioned place for secret *names*; skip it.
    const { secrets, ...rest } = manifest;
    walk(rest, "");

    // --- 5. Typed inputs: each `default` must match its declared type --------
    (manifest.inputs ?? []).forEach((input, i) => {
      if (input?.default === undefined) return;
      const where = `inputs[${i}]${input?.key ? ` (${input.key})` : ""}`;
      let check;
      try {
        check = ajv.compile(inputValueSchema(input));
      } catch {
        // Malformed input (e.g. enum with no options) — schema validation in
        // step 2 already reported the root cause; skip the default-check.
        return;
      }
      if (!check(input.default)) {
        const detail = (check.errors ?? [])
          .map((e) => `${e.instancePath || "value"} ${e.message}`)
          .join(", ");
        fail(`agent.yaml: ${where}.default does not satisfy its ${input.type ?? "text"} type — ${detail}`);
      }
    });

    // --- 6. Token scan: every {{token}} must be a declared input or builtin --
    const declared = new Set((manifest.inputs ?? []).map((x) => x?.key).filter(Boolean));
    const known = new Set([...declared, ...BUILTIN_TOKENS]);
    const TOKEN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
    const seen = new Set();
    const scanText = (text, label) => {
      if (typeof text !== "string") return;
      for (const m of text.matchAll(TOKEN)) {
        const tok = m[1];
        if (known.has(tok) || seen.has(tok)) continue;
        seen.add(tok);
        warn(`${label}: uses {{${tok}}} but no input declares it (and it is not a builtin) — add it to inputs[] or fix the typo`);
      }
    };
    // Inline manifest strings that get substituted.
    scanText(manifest.description, "agent.yaml: description");
    scanText(manifest.goal?.mission, "agent.yaml: goal.mission");
    scanText(manifest.goal?.definition_of_done, "agent.yaml: goal.definition_of_done");
    (manifest.schedules ?? []).forEach((s, i) => scanText(s?.instruction, `agent.yaml: schedules[${i}].instruction`));
    (manifest.webhooks ?? []).forEach((w, i) => scanText(w?.instruction, `agent.yaml: webhooks[${i}].instruction`));
    // Referenced markdown files (persona + knowledge).
    const scanFile = (rel, label) => {
      if (typeof rel !== "string") return;
      const p = join(bundleDir, rel);
      if (existsSync(p) && statSync(p).isFile()) scanText(readFileSync(p, "utf8"), label);
    };
    for (const k of ["personality", "identity", "instructions"]) {
      scanFile(manifest.persona?.[k], `${rel_or(manifest.persona?.[k], k)}`);
    }
    (manifest.knowledge ?? []).forEach((k) => scanFile(k?.path, k?.path ?? "knowledge"));
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Label helper: prefer the file path, fall back to the persona key name.
function rel_or(rel, key) {
  return typeof rel === "string" ? rel : `persona.${key}`;
}
