#!/usr/bin/env node
// agent-manifest deploy — validate the bundle directory, pack it as a
// .tar.gz, upload it to double.md, and open the deploy wizard in the
// browser. The wizard previews the bundle (persona, skills, inputs,
// integrations) and the actual deploy happens there with your existing
// browser session — the CLI never needs credentials.
//
// Usage: agentmanifest deploy [bundle-dir] [--server <url>] [--no-open]
//
// Server override (self-hosted / local dev):
//   agentmanifest deploy . --server http://localhost:3000
//   AGENTMANIFEST_SERVER=http://localhost:3000 agentmanifest deploy .

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { validateBundle } from "./validate-core.mjs";

const DEFAULT_SERVER = "https://www.double.md";
const MAX_FILE_BYTES = 1024 * 1024;        // mirrors the server's untar guard
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // mirrors Fetcher::MAX_BYTES

const args = process.argv.slice(2);
if (args[0] === "deploy") args.shift(); // tolerate cli.mjs passthrough

let server = process.env.AGENTMANIFEST_SERVER || DEFAULT_SERVER;
let noOpen = false;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--server") server = args[++i] ?? server;
  else if (args[i] === "--no-open") noOpen = true;
  else if (args[i].startsWith("--")) {
    console.error(`Unknown option: ${args[i]}`);
    process.exit(2);
  } else positional.push(args[i]);
}
server = server.replace(/\/+$/, "");
const bundleDir = resolve(positional[0] || ".");

// --- 1. Validate locally — never ship a broken bundle -----------------------
const { valid, errors } = validateBundle(bundleDir);
if (!valid) {
  console.error(`✗ ${bundleDir} is not a valid agent-bundle/v1 — fix before deploying:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ ${bundleDir} is a valid agent-bundle/v1`);

// --- 2. Collect files (same exclusions the server's untar applies) ----------
function collectFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;      // .git, .env, dotfiles
      if (name === "node_modules") continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) {
          console.error(`  skipping ${relative(root, abs)} (>1MB — the server would drop it too)`);
          continue;
        }
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

// --- 3. Pack as tar.gz (ustar, no deps) --------------------------------------
function tarHeader(name, size) {
  const buf = Buffer.alloc(512);
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    // ustar prefix split: prefix(155) + "/" + name(100)
    const idx = name.slice(0, 155).lastIndexOf("/");
    if (idx <= 0 || Buffer.byteLength(name.slice(idx + 1)) > 100) {
      throw new Error(`path too long for tar: ${name}`);
    }
    prefix = name.slice(0, idx);
    name = name.slice(idx + 1);
  }
  buf.write(name, 0, 100);
  buf.write("0000644\0", 100);                       // mode
  buf.write("0000000\0", 108);                       // uid
  buf.write("0000000\0", 116);                       // gid
  buf.write(size.toString(8).padStart(11, "0") + "\0", 124);
  buf.write("00000000000\0", 136);                   // mtime 0 → deterministic archive
  buf.write("        ", 148);                        // chksum placeholder
  buf.write("0", 156);                               // typeflag: regular file
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  buf.write(prefix, 345, 155);
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return buf;
}

function packTarGz(root, paths) {
  const chunks = [];
  for (const path of paths) {
    const content = readFileSync(join(root, path));
    chunks.push(tarHeader(path, content.length), content);
    const pad = 512 - (content.length % 512 || 512);
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024)); // end-of-archive
  return gzipSync(Buffer.concat(chunks));
}

const paths = collectFiles(bundleDir);
const tarball = packTarGz(bundleDir, paths);
if (tarball.length > MAX_UPLOAD_BYTES) {
  console.error(`✗ bundle is ${(tarball.length / 1024 / 1024).toFixed(1)}MB compressed — the server caps uploads at 10MB`);
  process.exit(1);
}
console.log(`→ packed ${paths.length} files (${(tarball.length / 1024).toFixed(1)}KB compressed)`);

// --- 4. Upload and open the deploy wizard ------------------------------------
const form = new FormData();
form.append("bundle", new Blob([tarball], { type: "application/gzip" }), "bundle.tar.gz");

let res;
try {
  res = await fetch(`${server}/agent_bundles/upload`, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
  });
} catch (e) {
  console.error(`✗ could not reach ${server} — ${e.cause?.message || e.message}`);
  process.exit(1);
}

let body;
try {
  body = await res.json();
} catch {
  body = {};
}
if (!res.ok || !body.url) {
  console.error(`✗ upload rejected (HTTP ${res.status})${body.error ? `: ${body.error}` : ""}`);
  process.exit(1);
}

console.log(`→ uploaded — finish the deploy in your browser:\n\n  ${body.url}\n`);
if (!noOpen) {
  const opener =
    process.platform === "darwin" ? ["open", [body.url]] :
    process.platform === "win32" ? ["cmd", ["/c", "start", "", body.url]] :
    ["xdg-open", [body.url]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {
    // No browser available (SSH session, CI) — the printed URL is enough.
  }).unref();
}
