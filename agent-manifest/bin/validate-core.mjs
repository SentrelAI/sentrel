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

// → { valid: boolean, errors: string[] }
export function validateBundle(bundleDir) {
  const errors = [];
  const fail = (msg) => errors.push(msg);

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
  }

  return { valid: errors.length === 0, errors };
}
