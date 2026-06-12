#!/usr/bin/env node
// agent-manifest validate — check an Agent Bundle directory against the
// agent-bundle/v1 spec: schema, referenced files, and secret-value scan.
//
// Usage: node bin/validate.mjs <bundle-dir> [--json]

import { resolve } from "node:path";
import { validateBundle } from "./validate-core.mjs";

const args = process.argv.slice(2);
if (args[0] === "validate") args.shift(); // tolerate cli.mjs passthrough
const asJson = args.includes("--json");
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("Usage: agent-manifest validate <bundle-dir> [--json]");
  process.exit(2);
}

const bundleDir = resolve(dir);
const { valid, errors } = validateBundle(bundleDir);

if (asJson) {
  console.log(JSON.stringify({ valid, errors }, null, 2));
} else if (errors.length) {
  console.error(`✗ ${bundleDir}`);
  for (const e of errors) console.error(`  - ${e}`);
} else {
  console.log(`✓ ${bundleDir} is a valid agent-bundle/v1`);
}
process.exit(errors.length ? 1 : 0);
